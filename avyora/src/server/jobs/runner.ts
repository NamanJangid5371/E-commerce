/**
 * In-process job runner for single-node / Docker Compose deployments.
 * Jobs always run in-process unless JOBS_BACKEND=external (explicit opt-out).
 * REDIS_URL alone no longer drops work — BullMQ is not shipped yet.
 */

import { notificationService } from "@/server/notifications/service";
import type { NotificationPayload } from "@/server/notifications/service";
import { isSmtpConfigured } from "@/lib/mail";
import { prisma } from "@/server/db";
import {
  ensureProductIndex,
  getMeiliClient,
  indexProduct,
  type ProductSearchDocument,
} from "@/server/search/meilisearch";
import { logger } from "@/server/logger";

export type JobHandler = (payload?: unknown) => Promise<void>;

type QueuedJob = {
  name: string;
  payload?: unknown;
};

const registry = new Map<string, JobHandler>();
const queue: QueuedJob[] = [];
let processing = false;

function jobsBackend(): "inprocess" | "external" {
  const raw = (process.env.JOBS_BACKEND || "inprocess").trim().toLowerCase();
  if (raw === "external" || raw === "redis" || raw === "bullmq") return "external";
  return "inprocess";
}

export function registerJob(name: string, handler: JobHandler): void {
  registry.set(name, handler);
}

export function enqueue(name: string, payload?: unknown): void {
  if (jobsBackend() === "external") {
    logger.info("jobs.external_enqueue_skipped", {
      name,
      hint: "JOBS_BACKEND=external — run your worker separately. Unset or use inprocess to process here.",
    });
    return;
  }

  if (!registry.has(name)) {
    logger.warn("jobs.unknown", { name });
    return;
  }

  queue.push({ name, payload });
  void processQueue();
}

export async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const job = queue.shift();
    if (!job) break;

    const handler = registry.get(job.name);
    if (!handler) continue;

    try {
      logger.info("jobs.run", { name: job.name });
      await handler(job.payload);
      logger.info("jobs.done", { name: job.name });
    } catch (error) {
      logger.error("jobs.failed", { name: job.name, error: String(error) });
    }
  }

  processing = false;
}

/** Run a registered job immediately (used by cron tick). */
export async function runJobNow(name: string, payload?: unknown): Promise<void> {
  const handler = registry.get(name);
  if (!handler) {
    throw new Error(`Unknown job "${name}"`);
  }
  await handler(payload);
}

registerJob("abandoned-cart-scan", async () => {
  const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.abandonedCart.findMany({
    where: {
      recovered: false,
      reminderCount: { lt: 2 },
      OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: staleBefore } }],
      cart: {
        updatedAt: { lt: staleBefore },
        items: { some: {} },
      },
    },
    take: 40,
    include: {
      cart: {
        include: {
          customer: { include: { user: { select: { email: true, name: true } } } },
          items: { include: { product: { select: { name: true } } } },
        },
      },
    },
  });

  if (!rows.length) {
    logger.info("jobs.abandoned_cart_scan.empty");
    return;
  }

  const storeOrigin =
    process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN?.trim() || "http://localhost:3000";

  for (const row of rows) {
    const email = row.cart.customer?.user?.email?.trim();
    if (!email) continue;

    const itemNames = row.cart.items
      .map((i) => i.product.name)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");

    await notificationService.send("email", {
      event: "abandoned_cart.reminder",
      recipient: email,
      subject: "Your Avyora bag is waiting",
      body: [
        `Hi${row.cart.customer?.user?.name ? ` ${row.cart.customer.user.name}` : ""},`,
        "",
        itemNames
          ? `You left ${itemNames} in your bag.`
          : "You left pieces in your bag.",
        `Continue checkout: ${storeOrigin}/bag`,
      ].join("\n"),
      metadata: { abandonedCartId: row.id, cartId: row.cartId },
    });

    await prisma.abandonedCart.update({
      where: { id: row.id },
      data: {
        reminderCount: { increment: 1 },
        lastReminderAt: new Date(),
      },
    });
  }

  logger.info("jobs.abandoned_cart_scan.done", {
    scanned: rows.length,
    smtp: isSmtpConfigured(),
  });
});

registerJob("search-reindex", async () => {
  if (!getMeiliClient()) {
    logger.info("jobs.search_reindex.skipped", { reason: "MEILISEARCH_HOST not set" });
    return;
  }

  await ensureProductIndex();

  const products = await prisma.product.findMany({
    where: { deletedAt: null, status: "PUBLISHED" },
    include: {
      variants: { orderBy: { createdAt: "asc" }, take: 1 },
      brand: { select: { name: true } },
      category: { select: { name: true } },
    },
    take: 5000,
  });

  let indexed = 0;
  for (const product of products) {
    const price = product.variants[0] ? Number(product.variants[0].price) : undefined;

    const doc: ProductSearchDocument = {
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description ?? undefined,
      shortDescription: product.shortDescription ?? undefined,
      category: product.category?.name ?? undefined,
      metal: product.metal ?? undefined,
      purity: product.purity ?? undefined,
      colour: product.colour ?? undefined,
      tags: product.tags ?? [],
      brand: product.brand?.name ?? undefined,
      price,
      rating: Number(product.rating) || undefined,
      reviewCount: product.reviewCount,
      featured: product.featured,
      bestSeller: product.bestSeller,
      newArrival: product.newArrival,
      searchable: product.searchable,
    };
    await indexProduct(doc);
    indexed += 1;
  }

  logger.info("jobs.search_reindex.done", { indexed });
});

registerJob("notification-dispatch", async (payload) => {
  const data = payload as {
    channel?: "email" | "whatsapp" | "sms";
    notification?: NotificationPayload;
  };

  if (!data?.notification) {
    logger.warn("jobs.notification_dispatch.missing_payload");
    return;
  }

  const channel = data.channel ?? "email";
  await notificationService.send(channel, data.notification);
});

registerJob("pending-payment-release", async () => {
  const { pendingPaymentTtlMinutes, releaseStalePendingPaymentOrders } = await import(
    "@/server/orders/release-pending-payment"
  );
  const ttlMinutes = pendingPaymentTtlMinutes();
  const summary = await releaseStalePendingPaymentOrders({ ttlMinutes });
  logger.info("jobs.pending_payment_release.done", { ...summary, ttlMinutes });
});

export const registeredJobs = () => [...registry.keys()];
