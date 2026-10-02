import { z } from "zod";
import type { Prisma, UserEventType } from "@prisma/client";
import { prisma } from "@/server/db";
import { USER_EVENT_TYPES } from "@/server/recommendations/types";
import { logger } from "@/server/logger";

export const trackEventSchema = z.object({
  eventType: z.enum(USER_EVENT_TYPES),
  productId: z.string().min(1).max(120).optional(),
  categoryId: z.string().min(1).max(120).optional(),
  searchQuery: z.string().min(1).max(120).optional(),
  anonId: z.string().uuid().optional(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
});

export type TrackEventInput = z.infer<typeof trackEventSchema>;

/**
 * Persist a behavioral event. userId MUST come from server session, never the client body.
 */
export async function ingestUserEvent(input: {
  userId?: string | null;
  anonId?: string | null;
  eventType: UserEventType | (typeof USER_EVENT_TYPES)[number];
  productId?: string | null;
  categoryId?: string | null;
  searchQuery?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<{ ok: boolean; id?: string }> {
  if (!input.userId && !input.anonId) {
    return { ok: false };
  }

  let productId = input.productId ?? null;
  let categoryId = input.categoryId ?? null;

  if (productId) {
    const product = await prisma.product.findFirst({
      where: {
        OR: [{ id: productId }, { slug: productId }, { legacyId: productId }],
        deletedAt: null,
      },
      select: { id: true, categoryId: true },
    });
    if (!product) {
      productId = null;
    } else {
      productId = product.id;
      categoryId = categoryId ?? product.categoryId;
    }
  }

  if (categoryId) {
    const cat = await prisma.category.findFirst({
      where: { OR: [{ id: categoryId }, { slug: categoryId }] },
      select: { id: true },
    });
    categoryId = cat?.id ?? null;
  }

  // Light dedupe: same user/anon + type + product within 8s
  const since = new Date(Date.now() - 8_000);
  const dup = await prisma.userEvent.findFirst({
    where: {
      eventType: input.eventType as UserEventType,
      productId: productId ?? undefined,
      createdAt: { gte: since },
      ...(input.userId ? { userId: input.userId } : { anonId: input.anonId ?? undefined }),
    },
    select: { id: true },
  });
  if (dup) return { ok: true, id: dup.id };

  try {
    const row = await prisma.userEvent.create({
      data: {
        userId: input.userId ?? null,
        anonId: input.anonId ?? null,
        eventType: input.eventType as UserEventType,
        productId,
        categoryId,
        searchQuery: input.searchQuery?.trim().slice(0, 120) || null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      select: { id: true },
    });
    return { ok: true, id: row.id };
  } catch (error) {
    logger.warn("recommendations.event_ingest_failed", { error: String(error) });
    return { ok: false };
  }
}
