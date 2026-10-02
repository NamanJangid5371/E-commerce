import { describe, expect, it } from "vitest";
import type { CandidateProduct } from "@/server/recommendations/candidates";
import type { PreferenceProfile } from "@/server/recommendations/profile";
import {
  diversifyAndExplore,
  reasonLabel,
  scoreCandidates,
} from "@/server/recommendations/scoring";
import { SCORE_WEIGHTS } from "@/server/recommendations/weights";

function product(partial: Partial<CandidateProduct> & Pick<CandidateProduct, "id" | "slug">): CandidateProduct {
  return {
    name: partial.name ?? partial.slug,
    categoryId: partial.categoryId ?? "cat-rings",
    brandId: partial.brandId ?? null,
    metal: partial.metal ?? "Gold",
    featured: false,
    bestSeller: false,
    newArrival: false,
    rating: 4.5,
    reviewCount: 10,
    price: partial.price ?? 25000,
    stock: partial.stock ?? 5,
    status: "PUBLISHED",
    ...partial,
  };
}

function emptyProfile(over: Partial<PreferenceProfile> = {}): PreferenceProfile {
  return {
    userId: "u1",
    anonId: null,
    categoryScores: {},
    brandScores: {},
    metalScores: {},
    preferredPriceMin: null,
    preferredPriceMax: null,
    viewedProductIds: [],
    purchasedProductIds: [],
    cartProductIds: [],
    wishlistProductIds: [],
    searchTerms: [],
    eventCount: 0,
    topReasonSignals: [],
    ...over,
  };
}

describe("recommendation scoring", () => {
  it("excludes out-of-stock products", () => {
    const ranked = scoreCandidates({
      candidates: [product({ id: "a", slug: "a", stock: 0 })],
      profile: emptyProfile({ categoryScores: { "cat-rings": 5 } }),
      context: "HOME",
    });
    expect(ranked).toHaveLength(0);
  });

  it("penalizes already purchased products", () => {
    const bought = product({ id: "bought", slug: "bought", categoryId: "cat-rings" });
    const other = product({ id: "other", slug: "other", categoryId: "cat-rings" });
    const ranked = scoreCandidates({
      candidates: [bought, other],
      profile: emptyProfile({
        categoryScores: { "cat-rings": 5 },
        purchasedProductIds: ["bought"],
      }),
      context: "HOME",
    });
    expect(ranked[0]?.product.id).toBe("other");
    const boughtRank = ranked.find((r) => r.product.id === "bought");
    if (boughtRank) {
      expect(boughtRank.score).toBeLessThan(
        ranked.find((r) => r.product.id === "other")!.score,
      );
    }
  });

  it("boosts category affinity and price match", () => {
    const inRange = product({ id: "in", slug: "in", price: 30000, categoryId: "cat-rings" });
    const outRange = product({ id: "out", slug: "out", price: 200000, categoryId: "cat-other" });
    const ranked = scoreCandidates({
      candidates: [outRange, inRange],
      profile: emptyProfile({
        categoryScores: { "cat-rings": 8 },
        preferredPriceMin: 20000,
        preferredPriceMax: 50000,
        topReasonSignals: ["browsing", "price"],
        eventCount: 10,
      }),
      context: "HOME",
    });
    expect(ranked[0]?.product.id).toBe("in");
    expect(ranked[0]!.score).toBeGreaterThan(SCORE_WEIGHTS.PRICE_MATCH);
  });

  it("excludes anchor product on product page", () => {
    const ranked = scoreCandidates({
      candidates: [
        product({ id: "anchor", slug: "anchor" }),
        product({ id: "sib", slug: "sib" }),
      ],
      profile: emptyProfile({ categoryScores: { "cat-rings": 3 } }),
      context: "PRODUCT_PAGE",
      excludeProductId: "anchor",
    });
    expect(ranked.every((r) => r.product.id !== "anchor")).toBe(true);
  });

  it("diversifies categories and injects exploration", () => {
    const pool = Array.from({ length: 12 }, (_, i) =>
      product({
        id: `p${i}`,
        slug: `p${i}`,
        categoryId: i < 10 ? "cat-a" : "cat-b",
        stock: 3,
      }),
    );
    const ranked = pool.map((p, i) => ({
      product: p,
      score: 100 - i,
      reasonCode: "category",
    }));
    const out = diversifyAndExplore(ranked, 8, pool);
    const catA = out.filter((r) => r.product.categoryId === "cat-a").length;
    expect(catA).toBeLessThanOrEqual(3);
    expect(out.length).toBeLessThanOrEqual(8);
  });

  it("returns privacy-safe reason labels", () => {
    expect(reasonLabel("browsing")).toMatch(/browsing/i);
    expect(reasonLabel("cart")).toMatch(/bag/i);
    expect(reasonLabel("unknown")).toBe("Picked for you");
  });

  it("applies cart context boost", () => {
    const ranked = scoreCandidates({
      candidates: [product({ id: "c1", slug: "c1", categoryId: "cat-rings" })],
      profile: emptyProfile({
        categoryScores: { "cat-rings": 4 },
        cartProductIds: ["other-cart-item"],
        topReasonSignals: ["cart"],
      }),
      context: "CART",
    });
    expect(ranked[0]?.reasonCode).toBe("cart");
  });

  it("does not recommend duplicate ids after diversity", () => {
    const p = product({ id: "dup", slug: "dup" });
    const out = diversifyAndExplore(
      [
        { product: p, score: 10, reasonCode: "popular" },
        { product: p, score: 9, reasonCode: "popular" },
      ],
      4,
      [p],
    );
    expect(out.filter((r) => r.product.id === "dup")).toHaveLength(1);
  });
});
