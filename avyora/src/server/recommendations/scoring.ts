import type { CandidateProduct } from "@/server/recommendations/candidates";
import type { PreferenceProfile } from "@/server/recommendations/profile";
import type { RecommendationContext } from "@/server/recommendations/types";
import {
  EXPLORATION_RATIO,
  MAX_PER_CATEGORY,
  SCORE_WEIGHTS,
} from "@/server/recommendations/weights";

export type RankedItem = {
  product: CandidateProduct;
  score: number;
  reasonCode: string;
};

function priceAffinity(price: number, profile: PreferenceProfile): number {
  if (profile.preferredPriceMin == null || profile.preferredPriceMax == null) return 0;
  if (price >= profile.preferredPriceMin && price <= profile.preferredPriceMax) {
    return SCORE_WEIGHTS.PRICE_MATCH;
  }
  const mid = (profile.preferredPriceMin + profile.preferredPriceMax) / 2;
  const span = Math.max(1, profile.preferredPriceMax - profile.preferredPriceMin);
  const dist = Math.abs(price - mid) / span;
  return Math.max(0, SCORE_WEIGHTS.PRICE_MATCH * (1 - Math.min(1.5, dist)));
}

function popularityScore(p: CandidateProduct): number {
  return Math.min(SCORE_WEIGHTS.POPULARITY * 2, (p.reviewCount * p.rating) / 50);
}

/**
 * Transparent weighted scoring. Weights live in weights.ts.
 */
export function scoreCandidates(input: {
  candidates: CandidateProduct[];
  profile: PreferenceProfile;
  context: RecommendationContext;
  excludeProductId?: string | null;
}): RankedItem[] {
  const cartSet = new Set(input.profile.cartProductIds);
  const wishSet = new Set(input.profile.wishlistProductIds);
  const purchasedSet = new Set(input.profile.purchasedProductIds);
  const viewedSet = new Set(input.profile.viewedProductIds);

  const ranked: RankedItem[] = [];

  for (const product of input.candidates) {
    if (input.excludeProductId && product.id === input.excludeProductId) continue;
    if (product.stock <= 0) continue;

    let score = 0;
    let reasonCode = "popular";

    const catScore = product.categoryId
      ? input.profile.categoryScores[product.categoryId] ?? 0
      : 0;
    if (catScore > 0) {
      score += Math.min(40, catScore) * (SCORE_WEIGHTS.PRODUCT_VIEW_CATEGORY / 10);
      reasonCode = "category";
    }

    if (product.brandId && input.profile.brandScores[product.brandId]) {
      score += Math.min(15, input.profile.brandScores[product.brandId]!);
    }

    if (product.metal && input.profile.metalScores[product.metal]) {
      score += SCORE_WEIGHTS.SAME_METAL;
    }

    const priceScore = priceAffinity(product.price, input.profile);
    score += priceScore;
    if (priceScore >= SCORE_WEIGHTS.PRICE_MATCH * 0.8 && reasonCode === "popular") {
      reasonCode = "price";
    }

    score += popularityScore(product);

    if (viewedSet.has(product.id)) {
      score += SCORE_WEIGHTS.RECENCY * 0.3;
    }

    // Context boosts
    if (input.context === "CART" || input.context === "CHECKOUT") {
      score += SCORE_WEIGHTS.COMPLEMENTARY * 0.5;
      if (catScore > 0) {
        score += SCORE_WEIGHTS.CART_CATEGORY * 0.3;
        reasonCode = "cart";
      }
    }
    if (input.context === "WISHLIST" && catScore > 0) {
      score += SCORE_WEIGHTS.WISHLIST_CATEGORY * 0.4;
      reasonCode = "wishlist";
    }
    if (input.context === "PRODUCT_PAGE") {
      score += SCORE_WEIGHTS.SAME_PRODUCT_CONTEXT * 0.5;
      reasonCode = reasonCode === "popular" ? "similar" : reasonCode;
    }
    if (input.context === "SEARCH" && input.profile.searchTerms.length) {
      score += SCORE_WEIGHTS.SEARCH_CATEGORY * 0.4;
      reasonCode = "search";
    }
    if (input.context === "POST_PURCHASE" && catScore > 0) {
      score += SCORE_WEIGHTS.PURCHASE_CATEGORY * 0.5;
      reasonCode = "purchase";
    }

    if (input.profile.topReasonSignals.includes("browsing") && catScore > 0) {
      reasonCode = reasonCode === "popular" ? "browsing" : reasonCode;
    }

    // Penalties
    if (purchasedSet.has(product.id)) score -= SCORE_WEIGHTS.ALREADY_PURCHASED_PENALTY;
    if (cartSet.has(product.id)) score -= SCORE_WEIGHTS.ALREADY_IN_CART_PENALTY;
    if (wishSet.has(product.id) && input.context !== "WISHLIST") {
      score -= SCORE_WEIGHTS.ALREADY_WISHLIST_PENALTY;
    }

    if (score <= 0) continue;
    ranked.push({ product, score, reasonCode });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

/** Enforce category diversity + optional exploration slots. */
export function diversifyAndExplore(
  ranked: RankedItem[],
  limit: number,
  explorationPool: CandidateProduct[],
): RankedItem[] {
  const out: RankedItem[] = [];
  const perCategory = new Map<string, number>();
  const used = new Set<string>();

  for (const item of ranked) {
    if (out.length >= limit) break;
    if (used.has(item.product.id)) continue;
    const cat = item.product.categoryId ?? "_";
    const count = perCategory.get(cat) ?? 0;
    if (count >= MAX_PER_CATEGORY) continue;
    out.push(item);
    used.add(item.product.id);
    perCategory.set(cat, count + 1);
  }

  const exploreSlots = Math.max(0, Math.floor(limit * EXPLORATION_RATIO));
  let added = 0;
  for (const product of explorationPool) {
    if (added >= exploreSlots) break;
    if (used.has(product.id) || product.stock <= 0) continue;
    const cat = product.categoryId ?? "_";
    if ((perCategory.get(cat) ?? 0) >= MAX_PER_CATEGORY) continue;
    out.push({
      product,
      score: 1,
      reasonCode: "explore",
    });
    used.add(product.id);
    perCategory.set(cat, (perCategory.get(cat) ?? 0) + 1);
    added += 1;
  }

  return out.slice(0, limit);
}

export function reasonLabel(code: string): string {
  switch (code) {
    case "browsing":
      return "Based on your recent browsing";
    case "category":
      return "Popular in categories you shop";
    case "wishlist":
      return "Similar to items in your wishlist";
    case "cart":
      return "Complements items in your bag";
    case "search":
      return "Based on your recent searches";
    case "price":
      return "Picked for your price range";
    case "purchase":
      return "Because of your past purchases";
    case "similar":
      return "Similar to this piece";
    case "explore":
      return "Explore something new";
    default:
      return "Picked for you";
  }
}
