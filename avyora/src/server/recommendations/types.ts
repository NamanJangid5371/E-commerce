/**
 * Recommendation engine contracts — rule-based now, ML-swappable later.
 *
 * Preference profile strategy: computed on demand from UserEvent + cart/wishlist/orders
 * (last N days), with short TTL cache in RecommendationCache. Avoids a separate denormalized
 * profile table until event volume justifies background aggregation jobs.
 */

export const RECOMMENDATION_CONTEXTS = [
  "HOME",
  "PRODUCT_PAGE",
  "CART",
  "CHECKOUT",
  "SEARCH",
  "WISHLIST",
  "POST_PURCHASE",
] as const;

export type RecommendationContext = (typeof RECOMMENDATION_CONTEXTS)[number];

export const USER_EVENT_TYPES = [
  "PRODUCT_VIEW",
  "PRODUCT_CLICK",
  "SEARCH",
  "ADD_TO_CART",
  "REMOVE_FROM_CART",
  "WISHLIST_ADD",
  "WISHLIST_REMOVE",
  "PURCHASE",
  "RECOMMENDATION_IMPRESSION",
  "RECOMMENDATION_CLICK",
] as const;

export type UserEventTypeName = (typeof USER_EVENT_TYPES)[number];

export type RecommendationRequest = {
  userId?: string | null;
  anonId?: string | null;
  context: RecommendationContext;
  limit?: number;
  productId?: string | null;
  categoryId?: string | null;
  searchQuery?: string | null;
  /** Client cart product ids (legacyId or cuid) — optional enrichment */
  cartProductIds?: string[];
  wishlistProductIds?: string[];
};

export type ScoredRecommendation = {
  productId: string;
  slug: string;
  score: number;
  reasonCode: string;
  reasonLabel: string;
};

export type RecommendationResult = {
  context: RecommendationContext;
  recommendations: ScoredRecommendation[];
  strategy: "personalized" | "cold_start" | "contextual" | "fallback";
};

export interface RecommendationEngine {
  getRecommendations(request: RecommendationRequest): Promise<RecommendationResult>;
}
