import type { UserEventType } from "@prisma/client";
import { prisma } from "@/server/db";
import {
  AFFINITY_HALF_LIFE_DAYS,
  PROFILE_EVENT_LIMIT,
} from "@/server/recommendations/weights";

export type PreferenceProfile = {
  userId: string | null;
  anonId: string | null;
  categoryScores: Record<string, number>;
  brandScores: Record<string, number>;
  metalScores: Record<string, number>;
  preferredPriceMin: number | null;
  preferredPriceMax: number | null;
  viewedProductIds: string[];
  purchasedProductIds: string[];
  cartProductIds: string[];
  wishlistProductIds: string[];
  searchTerms: string[];
  eventCount: number;
  topReasonSignals: string[];
};

function decayWeight(createdAt: Date, now: number): number {
  const ageDays = Math.max(0, (now - createdAt.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / AFFINITY_HALF_LIFE_DAYS);
}

const CATEGORY_EVENT_WEIGHT: Partial<Record<UserEventType, number>> = {
  PRODUCT_VIEW: 1,
  PRODUCT_CLICK: 1.2,
  SEARCH: 1.5,
  WISHLIST_ADD: 2,
  ADD_TO_CART: 2.5,
  PURCHASE: 3,
  RECOMMENDATION_CLICK: 1.4,
};

/**
 * Build a preference profile from UserEvent + live cart/wishlist/orders.
 * Real-time aggregation with event cap — suitable until volume needs a job.
 */
export async function buildPreferenceProfile(input: {
  userId?: string | null;
  anonId?: string | null;
  cartProductIds?: string[];
  wishlistProductIds?: string[];
}): Promise<PreferenceProfile> {
  const now = Date.now();
  const categoryScores: Record<string, number> = {};
  const brandScores: Record<string, number> = {};
  const metalScores: Record<string, number> = {};
  const viewedProductIds: string[] = [];
  const purchasedProductIds: string[] = [];
  const searchTerms: string[] = [];
  const topReasonSignals: string[] = [];
  const prices: number[] = [];

  const where =
    input.userId
      ? { userId: input.userId }
      : input.anonId
        ? { anonId: input.anonId }
        : null;

  let eventCount = 0;

  if (where) {
    const events = await prisma.userEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PROFILE_EVENT_LIMIT,
      include: {
        product: {
          select: {
            id: true,
            categoryId: true,
            brandId: true,
            metal: true,
            variants: { select: { price: true, salePrice: true }, take: 3 },
          },
        },
      },
    });
    eventCount = events.length;

    for (const event of events) {
      const w = (CATEGORY_EVENT_WEIGHT[event.eventType] ?? 0.5) * decayWeight(event.createdAt, now);
      const categoryId = event.categoryId ?? event.product?.categoryId ?? null;
      if (categoryId) {
        categoryScores[categoryId] = (categoryScores[categoryId] ?? 0) + w;
      }
      if (event.product?.brandId) {
        brandScores[event.product.brandId] = (brandScores[event.product.brandId] ?? 0) + w * 0.6;
      }
      if (event.product?.metal) {
        metalScores[event.product.metal] = (metalScores[event.product.metal] ?? 0) + w * 0.5;
      }
      if (event.productId && (event.eventType === "PRODUCT_VIEW" || event.eventType === "PRODUCT_CLICK")) {
        if (!viewedProductIds.includes(event.productId)) viewedProductIds.push(event.productId);
      }
      if (event.productId && event.eventType === "PURCHASE") {
        if (!purchasedProductIds.includes(event.productId)) purchasedProductIds.push(event.productId);
      }
      if (event.searchQuery?.trim()) {
        const q = event.searchQuery.trim().toLowerCase().slice(0, 80);
        if (!searchTerms.includes(q)) searchTerms.push(q);
      }
      const variant = event.product?.variants?.[0];
      if (variant) {
        const price = Number(variant.salePrice ?? variant.price);
        if (Number.isFinite(price) && price > 0) prices.push(price);
      }
    }

    if (Object.keys(categoryScores).some((k) => (categoryScores[k] ?? 0) > 2)) {
      topReasonSignals.push("browsing");
    }
    if (searchTerms.length) topReasonSignals.push("search");
  }

  // Enrich from authenticated cart / wishlist / purchases in Postgres
  if (input.userId) {
    const customer = await prisma.customer.findUnique({
      where: { userId: input.userId },
      select: {
        id: true,
        cart: {
          include: {
            items: {
              include: {
                product: { select: { id: true, categoryId: true, brandId: true, metal: true, variants: { take: 1 } } },
              },
            },
          },
        },
        wishlistItems: {
          include: {
            product: { select: { id: true, categoryId: true, brandId: true, metal: true, variants: { take: 1 } } },
          },
        },
        orders: {
          where: { status: { notIn: ["CANCELLED", "REFUNDED"] } },
          take: 40,
          orderBy: { createdAt: "desc" },
          include: {
            items: {
              include: {
                product: { select: { id: true, categoryId: true, brandId: true, metal: true } },
                variant: { select: { price: true, salePrice: true } },
              },
            },
          },
        },
      },
    });

    for (const item of customer?.cart?.items ?? []) {
      const pid = item.product.id;
      if (!input.cartProductIds?.includes(pid)) {
        // still score
      }
      if (item.product.categoryId) {
        categoryScores[item.product.categoryId] =
          (categoryScores[item.product.categoryId] ?? 0) + 2.5;
      }
      if (!purchasedProductIds.includes(pid)) {
        /* cart only */
      }
    }
    if ((customer?.cart?.items.length ?? 0) > 0) topReasonSignals.push("cart");

    for (const item of customer?.wishlistItems ?? []) {
      if (item.product.categoryId) {
        categoryScores[item.product.categoryId] =
          (categoryScores[item.product.categoryId] ?? 0) + 2;
      }
      const v = item.product.variants[0];
      if (v) {
        const price = Number(v.salePrice ?? v.price);
        if (Number.isFinite(price) && price > 0) prices.push(price);
      }
    }
    if ((customer?.wishlistItems.length ?? 0) > 0) topReasonSignals.push("wishlist");

    for (const order of customer?.orders ?? []) {
      for (const line of order.items) {
        if (!purchasedProductIds.includes(line.product.id)) {
          purchasedProductIds.push(line.product.id);
        }
        if (line.product.categoryId) {
          categoryScores[line.product.categoryId] =
            (categoryScores[line.product.categoryId] ?? 0) + 3;
        }
        const price = Number(line.variant.salePrice ?? line.variant.price);
        if (Number.isFinite(price) && price > 0) prices.push(price);
      }
    }
    if ((customer?.orders.length ?? 0) > 0) topReasonSignals.push("purchase");
  }

  // Client-provided cart/wishlist ids (guest Zustand) — resolve categories
  const extraIds = [
    ...(input.cartProductIds ?? []),
    ...(input.wishlistProductIds ?? []),
  ];
  if (extraIds.length) {
    const extras = await prisma.product.findMany({
      where: {
        OR: [{ id: { in: extraIds } }, { legacyId: { in: extraIds } }, { slug: { in: extraIds } }],
        deletedAt: null,
      },
      select: {
        id: true,
        categoryId: true,
        variants: { select: { price: true, salePrice: true }, take: 1 },
      },
      take: 60,
    });
    const cartSet = new Set(input.cartProductIds ?? []);
    const wishSet = new Set(input.wishlistProductIds ?? []);
    for (const p of extras) {
      const boost = cartSet.has(p.id) || [...cartSet].some((id) => id === p.id) ? 2.5 : 2;
      if (p.categoryId) categoryScores[p.categoryId] = (categoryScores[p.categoryId] ?? 0) + boost;
      const v = p.variants[0];
      if (v) {
        const price = Number(v.salePrice ?? v.price);
        if (Number.isFinite(price) && price > 0) prices.push(price);
      }
      if (wishSet.has(p.id) || [...wishSet].some((id) => id === p.id)) {
        if (!topReasonSignals.includes("wishlist")) topReasonSignals.push("wishlist");
      }
      if (cartSet.has(p.id) || [...cartSet].some((id) => id === p.id)) {
        if (!topReasonSignals.includes("cart")) topReasonSignals.push("cart");
      }
    }
  }

  let preferredPriceMin: number | null = null;
  let preferredPriceMax: number | null = null;
  if (prices.length >= 2) {
    const sorted = [...prices].sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.2)] ?? sorted[0]!;
    const hi = sorted[Math.floor(sorted.length * 0.8)] ?? sorted[sorted.length - 1]!;
    preferredPriceMin = Math.max(0, lo * 0.75);
    preferredPriceMax = hi * 1.35;
    topReasonSignals.push("price");
  } else if (prices.length === 1) {
    preferredPriceMin = prices[0]! * 0.6;
    preferredPriceMax = prices[0]! * 1.5;
  }

  return {
    userId: input.userId ?? null,
    anonId: input.anonId ?? null,
    categoryScores,
    brandScores,
    metalScores,
    preferredPriceMin,
    preferredPriceMax,
    viewedProductIds,
    purchasedProductIds,
    cartProductIds: input.cartProductIds ?? [],
    wishlistProductIds: input.wishlistProductIds ?? [],
    searchTerms,
    eventCount,
    topReasonSignals: [...new Set(topReasonSignals)],
  };
}
