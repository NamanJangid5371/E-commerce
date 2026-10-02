import { generateCandidates } from "@/server/recommendations/candidates";
import { buildPreferenceProfile } from "@/server/recommendations/profile";
import {
  diversifyAndExplore,
  reasonLabel,
  scoreCandidates,
} from "@/server/recommendations/scoring";
import type {
  RecommendationEngine,
  RecommendationRequest,
  RecommendationResult,
  ScoredRecommendation,
} from "@/server/recommendations/types";
import {
  ACTIVE_USER_MIN_EVENTS,
  COLD_START_BLEND,
  LIGHT_USER_MIN_EVENTS,
} from "@/server/recommendations/weights";
import { prisma } from "@/server/db";
import { logger } from "@/server/logger";

function blendBucket(eventCount: number) {
  if (eventCount >= ACTIVE_USER_MIN_EVENTS) return COLD_START_BLEND.activeUser;
  if (eventCount >= LIGHT_USER_MIN_EVENTS) return COLD_START_BLEND.lightUser;
  return COLD_START_BLEND.newUser;
}

/**
 * RuleBasedRecommendationEngine — production rule engine.
 * Swap via RecommendationEngine interface for future MLRecommendationEngine.
 */
export class RuleBasedRecommendationEngine implements RecommendationEngine {
  async getRecommendations(request: RecommendationRequest): Promise<RecommendationResult> {
    const limit = Math.min(Math.max(request.limit ?? 8, 1), 24);
    const started = Date.now();

    try {
      const profile = await buildPreferenceProfile({
        userId: request.userId,
        anonId: request.anonId,
        cartProductIds: request.cartProductIds,
        wishlistProductIds: request.wishlistProductIds,
      });

      const candidates = await generateCandidates({
        profile,
        context: request.context,
        productId: request.productId,
        categoryId: request.categoryId,
        searchQuery: request.searchQuery,
      });

      if (!candidates.length) {
        return {
          context: request.context,
          recommendations: [],
          strategy: "fallback",
        };
      }

      const blend = blendBucket(profile.eventCount);
      const ranked = scoreCandidates({
        candidates,
        profile,
        context: request.context,
        excludeProductId: request.productId,
      });

      // Cold-start: inject popular/new into pool before diversity
      if (blend.personalized < 70) {
        const popular = candidates
          .filter((c) => c.bestSeller || c.featured || c.newArrival)
          .slice(0, Math.ceil(limit * (blend.popular / 100)));
        for (const p of popular) {
          if (!ranked.some((r) => r.product.id === p.id)) {
            ranked.push({ product: p, score: 5 + popularityBoost(p), reasonCode: "popular" });
          }
        }
        ranked.sort((a, b) => b.score - a.score);
      }

      const diversified = diversifyAndExplore(ranked, limit, candidates);
      const recommendations: ScoredRecommendation[] = diversified.map((item) => ({
        productId: item.product.id,
        slug: item.product.slug,
        score: Math.round(item.score * 100) / 100,
        reasonCode: item.reasonCode,
        reasonLabel: reasonLabel(item.reasonCode),
      }));

      const strategy =
        profile.eventCount === 0 && !request.cartProductIds?.length && !request.wishlistProductIds?.length
          ? "cold_start"
          : profile.eventCount < LIGHT_USER_MIN_EVENTS
            ? "contextual"
            : "personalized";

      const elapsed = Date.now() - started;
      if (elapsed > 800) {
        logger.warn("recommendations.slow", { ms: elapsed, context: request.context });
      }

      return { context: request.context, recommendations, strategy };
    } catch (error) {
      logger.error("recommendations.failed", { error: String(error), context: request.context });
      // Graceful fallback: bestsellers
      const fallback = await prisma.product.findMany({
        where: { status: "PUBLISHED", deletedAt: null, bestSeller: true },
        select: { id: true, slug: true },
        take: limit,
        orderBy: { reviewCount: "desc" },
      });
      return {
        context: request.context,
        strategy: "fallback",
        recommendations: fallback.map((p) => ({
          productId: p.id,
          slug: p.slug,
          score: 1,
          reasonCode: "popular",
          reasonLabel: reasonLabel("popular"),
        })),
      };
    }
  }
}

function popularityBoost(p: { reviewCount: number; rating: number }): number {
  return Math.min(10, (p.reviewCount * p.rating) / 40);
}

export const recommendationEngine: RecommendationEngine = new RuleBasedRecommendationEngine();
