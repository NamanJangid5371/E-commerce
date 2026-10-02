import { prisma } from "@/server/db";
import { logger } from "@/server/logger";

export type RecommendationAnalytics = {
  impressions: number;
  clicks: number;
  ctr: number;
  addToCartAfterClick: number;
  purchasesAfterClick: number;
  conversionRate: number;
  byContext: { context: string; impressions: number; clicks: number; ctr: number }[];
  topClickedProducts: { productId: string; name: string | null; clicks: number }[];
};

function emptyAnalytics(): RecommendationAnalytics {
  return {
    impressions: 0,
    clicks: 0,
    ctr: 0,
    addToCartAfterClick: 0,
    purchasesAfterClick: 0,
    conversionRate: 0,
    byContext: [],
    topClickedProducts: [],
  };
}

function userEventDelegateAvailable(): boolean {
  const delegate = (prisma as { userEvent?: { count?: unknown } }).userEvent;
  return typeof delegate?.count === "function";
}

/**
 * Aggregated recommendation performance (no per-user PII).
 */
export async function getRecommendationAnalytics(days = 30): Promise<RecommendationAnalytics> {
  if (!userEventDelegateAvailable()) {
    logger.warn("recommendations.analytics_client_stale", {
      hint: "Restart the admin Next.js process after prisma generate so UserEvent is available.",
    });
    return emptyAnalytics();
  }

  const since = new Date(Date.now() - days * 86_400_000);

  try {
    const [impressions, clicks, addToCart, purchases, clickEvents] = await Promise.all([
      prisma.userEvent.count({
        where: { eventType: "RECOMMENDATION_IMPRESSION", createdAt: { gte: since } },
      }),
      prisma.userEvent.count({
        where: { eventType: "RECOMMENDATION_CLICK", createdAt: { gte: since } },
      }),
      prisma.userEvent.count({
        where: { eventType: "ADD_TO_CART", createdAt: { gte: since } },
      }),
      prisma.userEvent.count({
        where: { eventType: "PURCHASE", createdAt: { gte: since } },
      }),
      prisma.userEvent.findMany({
        where: { eventType: "RECOMMENDATION_CLICK", createdAt: { gte: since } },
        select: { productId: true, metadata: true, product: { select: { name: true } } },
        take: 2000,
      }),
    ]);

    const byContextMap = new Map<string, { impressions: number; clicks: number }>();
    const impressionMeta = await prisma.userEvent.findMany({
      where: { eventType: "RECOMMENDATION_IMPRESSION", createdAt: { gte: since } },
      select: { metadata: true },
      take: 5000,
    });
    for (const row of impressionMeta) {
      const ctx =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? String((row.metadata as Record<string, unknown>).context ?? "UNKNOWN")
          : "UNKNOWN";
      const cur = byContextMap.get(ctx) ?? { impressions: 0, clicks: 0 };
      cur.impressions += 1;
      byContextMap.set(ctx, cur);
    }
    for (const row of clickEvents) {
      const ctx =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? String((row.metadata as Record<string, unknown>).context ?? "UNKNOWN")
          : "UNKNOWN";
      const cur = byContextMap.get(ctx) ?? { impressions: 0, clicks: 0 };
      cur.clicks += 1;
      byContextMap.set(ctx, cur);
    }

    const clickCount = new Map<string, { name: string | null; clicks: number }>();
    for (const row of clickEvents) {
      if (!row.productId) continue;
      const cur = clickCount.get(row.productId) ?? { name: row.product?.name ?? null, clicks: 0 };
      cur.clicks += 1;
      clickCount.set(row.productId, cur);
    }

    const topClickedProducts = [...clickCount.entries()]
      .map(([productId, v]) => ({ productId, name: v.name, clicks: v.clicks }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10);

    const ctr = impressions > 0 ? clicks / impressions : 0;
    const conversionRate = clicks > 0 ? purchases / clicks : 0;

    return {
      impressions,
      clicks,
      ctr,
      addToCartAfterClick: addToCart,
      purchasesAfterClick: purchases,
      conversionRate,
      byContext: [...byContextMap.entries()].map(([context, v]) => ({
        context,
        impressions: v.impressions,
        clicks: v.clicks,
        ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
      })),
      topClickedProducts,
    };
  } catch (error) {
    // Common after schema add: long-lived Next process still holds pre-UserEvent Prisma client,
    // or user_events table not migrated yet. Do not 500 the admin UI.
    logger.warn("recommendations.analytics_failed", { error: String(error) });
    return emptyAnalytics();
  }
}
