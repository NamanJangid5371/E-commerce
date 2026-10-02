import { createHash } from "crypto";
import { prisma } from "@/server/db";
import { recommendationEngine } from "@/server/recommendations/rule-engine";
import type {
  RecommendationRequest,
  RecommendationResult,
} from "@/server/recommendations/types";
import { REC_CACHE_TTL_SEC } from "@/server/recommendations/weights";

function cacheKey(request: RecommendationRequest): string {
  const raw = JSON.stringify({
    u: request.userId ?? null,
    a: request.anonId ?? null,
    c: request.context,
    l: request.limit ?? 8,
    p: request.productId ?? null,
    cat: request.categoryId ?? null,
    q: request.searchQuery ?? null,
  });
  return `rec:${createHash("sha256").update(raw).digest("hex").slice(0, 40)}`;
}

/**
 * Facade used by HTTP API. Depends on RecommendationEngine interface (ML-ready).
 */
export async function getRecommendations(
  request: RecommendationRequest,
): Promise<RecommendationResult> {
  const key = cacheKey(request);
  const now = new Date();

  try {
    const cached = await prisma.recommendationCache.findUnique({ where: { key } });
    if (cached?.expiresAt && cached.expiresAt > now && cached.productIds.length) {
      const products = await prisma.product.findMany({
        where: { id: { in: cached.productIds }, status: "PUBLISHED", deletedAt: null },
        select: { id: true, slug: true },
      });
      const byId = new Map(products.map((p) => [p.id, p]));
      const recommendations = cached.productIds
        .map((id, i) => {
          const p = byId.get(id);
          if (!p) return null;
          return {
            productId: p.id,
            slug: p.slug,
            score: Math.max(1, 20 - i),
            reasonCode: "cached",
            reasonLabel: "Picked for you",
          };
        })
        .filter((r): r is NonNullable<typeof r> => Boolean(r));
      if (recommendations.length) {
        return { context: request.context, strategy: "personalized", recommendations };
      }
    }
  } catch {
    /* cache miss / DB issue — continue */
  }

  const result = await recommendationEngine.getRecommendations(request);

  try {
    await prisma.recommendationCache.upsert({
      where: { key },
      create: {
        key,
        type: `${request.context}:${request.userId ?? request.anonId ?? "anon"}`,
        productIds: result.recommendations.map((r) => r.productId),
        expiresAt: new Date(Date.now() + REC_CACHE_TTL_SEC * 1000),
      },
      update: {
        type: `${request.context}:${request.userId ?? request.anonId ?? "anon"}`,
        productIds: result.recommendations.map((r) => r.productId),
        expiresAt: new Date(Date.now() + REC_CACHE_TTL_SEC * 1000),
      },
    });
  } catch {
    /* non-fatal */
  }

  return result;
}

/** Invalidate cached rows for a user/anon after meaningful events. */
export async function invalidateRecommendationCache(userOrAnonId?: string): Promise<void> {
  if (!userOrAnonId) return;
  try {
    await prisma.recommendationCache.deleteMany({
      where: { type: { contains: userOrAnonId } },
    });
  } catch {
    /* ignore */
  }
}
