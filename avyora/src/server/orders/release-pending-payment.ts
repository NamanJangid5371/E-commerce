import { prisma } from "@/server/db";
import {
  releaseInventoryHoldForOrder,
  reserveReasonTag,
  restockConfirmedInventoryForOrder,
  stockLinesFromOrderItems,
} from "@/server/inventory/reservation";
import { logger } from "@/server/logger";
import { mapPrismaOrderToClient, orderDetailInclude } from "@/server/orders/map-order";
import { mirrorClientOrderToCommerce } from "@/server/orders/mirror-commerce";

export const PENDING_PAYMENT_RESTOCK_REASON = "pending_payment_ttl_restock";
export const PENDING_PAYMENT_CANCEL_REASON =
  "Automatically cancelled — payment not completed in time";

const ACTOR = "system:pending-payment-ttl";
const DEFAULT_TTL_MINUTES = 30;
const DEFAULT_BATCH = 40;

export function pendingPaymentTtlMinutes(): number {
  const raw = Number(process.env.PENDING_PAYMENT_TTL_MINUTES);
  if (Number.isFinite(raw) && raw >= 5 && raw <= 24 * 60) return Math.floor(raw);
  return DEFAULT_TTL_MINUTES;
}

export function restockReasonTag(orderId: string): string {
  return `${PENDING_PAYMENT_RESTOCK_REASON}:${orderId}`;
}

/**
 * Cancel a single PENDING_PAYMENT order and restock once.
 * Idempotent: only wins if status is still PENDING_PAYMENT; stock movements tagged per order.
 */
export async function releasePendingPaymentOrder(
  orderId: string,
): Promise<"released" | "skipped" | "confirmed"> {
  const taggedReason = restockReasonTag(orderId);

  const result = await prisma.$transaction(async (tx) => {
    // Never TTL-cancel an order that already has a captured payment.
    const paid = await tx.payment.findFirst({
      where: { orderId, status: "SUCCESS" },
      select: { id: true },
    });
    if (paid) {
      const confirmed = await tx.order.updateMany({
        where: { id: orderId, status: "PENDING_PAYMENT" },
        data: { status: "PAYMENT_CONFIRMED", cancelReason: null },
      });
      if (confirmed.count === 1) {
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            status: "PAYMENT_CONFIRMED",
            note: "Pending-payment TTL skipped — payment already SUCCESS",
            actorEmail: ACTOR,
          },
        });
        return "confirmed" as const;
      }
      return "skipped" as const;
    }

    const claimed = await tx.order.updateMany({
      where: { id: orderId, status: "PENDING_PAYMENT" },
      data: {
        status: "CANCELLED",
        cancelReason: PENDING_PAYMENT_CANCEL_REASON,
      },
    });

    if (claimed.count !== 1) {
      return "skipped" as const;
    }

    // Re-check inside the claim window: a concurrent verify may have marked SUCCESS
    // after our paid check but before cancel. Roll cancel back to confirmed.
    const paidAfterClaim = await tx.payment.findFirst({
      where: { orderId, status: "SUCCESS" },
      select: { id: true },
    });
    if (paidAfterClaim) {
      await tx.order.update({
        where: { id: orderId },
        data: { status: "PAYMENT_CONFIRMED", cancelReason: null },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: "PAYMENT_CONFIRMED",
          note: "Pending-payment TTL aborted — payment SUCCESS raced cancel",
          actorEmail: ACTOR,
        },
      });
      return "confirmed" as const;
    }

    const alreadyRestocked = await tx.stockMovement.findFirst({
      where: { reason: taggedReason },
      select: { id: true },
    });
    if (alreadyRestocked) {
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: "CANCELLED",
          note: PENDING_PAYMENT_CANCEL_REASON,
          actorEmail: ACTOR,
        },
      });
      await tx.payment.updateMany({
        where: { orderId, provider: "razorpay", status: "PENDING" },
        data: { status: "FAILED" },
      });
      return "released" as const;
    }

    const items = await tx.orderItem.findMany({ where: { orderId } });
    const lines = stockLinesFromOrderItems(items);
    const hadSoftHold = await tx.stockMovement.findFirst({
      where: { reason: reserveReasonTag(orderId) },
      select: { id: true },
    });
    if (hadSoftHold) {
      // Soft-hold release: restore sellable stock, clear Inventory.reserved (on-hand unchanged).
      await releaseInventoryHoldForOrder(tx, orderId, lines, {
        actorEmail: ACTOR,
        reasonTag: taggedReason,
      });
    } else {
      // Legacy place path hard-decremented on-hand — put quantity back too.
      await restockConfirmedInventoryForOrder(tx, orderId, lines, {
        actorEmail: ACTOR,
        reasonTag: taggedReason,
      });
    }

    await tx.orderStatusHistory.create({
      data: {
        orderId,
        status: "CANCELLED",
        note: PENDING_PAYMENT_CANCEL_REASON,
        actorEmail: ACTOR,
      },
    });

    await tx.payment.updateMany({
      where: { orderId, provider: "razorpay", status: "PENDING" },
      data: { status: "FAILED" },
    });

    return "released" as const;
  });

  if (result === "released" || result === "confirmed") {
    try {
      const fresh = await prisma.order.findUnique({
        where: { id: orderId },
        include: orderDetailInclude,
      });
      if (fresh) await mirrorClientOrderToCommerce(mapPrismaOrderToClient(fresh));
    } catch (error) {
      logger.warn("orders.pending_payment_release.mirror_failed", {
        orderId,
        error: String(error),
      });
    }
  }

  return result;
}

export async function releaseStalePendingPaymentOrders(options?: {
  ttlMinutes?: number;
  take?: number;
}): Promise<{ scanned: number; released: number; skipped: number }> {
  const ttlMinutes = options?.ttlMinutes ?? pendingPaymentTtlMinutes();
  const take = options?.take ?? DEFAULT_BATCH;
  const cutoff = new Date(Date.now() - ttlMinutes * 60_000);

  const stale = await prisma.order.findMany({
    where: {
      status: "PENDING_PAYMENT",
      createdAt: { lt: cutoff },
      paymentMethod: { not: "cod" },
    },
    select: { id: true, orderNumber: true },
    orderBy: { createdAt: "asc" },
    take,
  });

  let released = 0;
  let skipped = 0;
  let confirmed = 0;

  for (const order of stale) {
    try {
      const outcome = await releasePendingPaymentOrder(order.id);
      if (outcome === "released") {
        released += 1;
        logger.info("orders.pending_payment_release.released", {
          orderId: order.id,
          orderNumber: order.orderNumber,
          ttlMinutes,
        });
      } else if (outcome === "confirmed") {
        confirmed += 1;
        logger.info("orders.pending_payment_release.confirmed_paid", {
          orderId: order.id,
          orderNumber: order.orderNumber,
          ttlMinutes,
        });
      } else {
        skipped += 1;
      }
    } catch (error) {
      skipped += 1;
      logger.error("orders.pending_payment_release.order_failed", {
        orderId: order.id,
        error: String(error),
      });
    }
  }

  return { scanned: stale.length, released, skipped, confirmed };
}
