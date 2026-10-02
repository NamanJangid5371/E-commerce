/**
 * Rules-based product recommendations.
 * Pure functions over in-memory product arrays — no ML inference.
 */

export type RecommendableProduct = {
  id: string;
  slug: string;
  name: string;
  category: string;
  metal: string;
  rating: number;
  reviewCount: number;
  images?: string[];
  variants?: { price: number; salePrice?: number; stock?: number }[];
};

export type OrderCoOccurrenceMap = Record<string, Record<string, number>>;

function lowestPrice(product: RecommendableProduct): number {
  if (!product.variants?.length) return 0;
  return Math.min(
    ...product.variants.map((variant) =>
      variant.salePrice != null ? variant.salePrice : variant.price,
    ),
  );
}

function inStock(product: RecommendableProduct): boolean {
  if (!product.variants?.length) return true;
  return product.variants.some((variant) => (variant.stock ?? 1) > 0);
}

function trendingScore(product: RecommendableProduct): number {
  // Weight review volume and average rating equally for a simple popularity score.
  return product.reviewCount * product.rating;
}

/**
 * Products in the same category and metal as the anchor, excluding the anchor itself.
 */
export function similarByCategoryMetal(
  anchor: RecommendableProduct,
  catalog: RecommendableProduct[],
  limit = 8,
): RecommendableProduct[] {
  return catalog
    .filter(
      (product) =>
        product.id !== anchor.id &&
        product.category === anchor.category &&
        product.metal === anchor.metal &&
        inStock(product),
    )
    .sort((a, b) => trendingScore(b) - trendingScore(a) || lowestPrice(a) - lowestPrice(b))
    .slice(0, limit);
}

/**
 * Frequently bought together from order co-occurrence counts.
 * Pass a map built by scanning order line items: productA -> { productB: count }.
 */
export function frequentlyBoughtTogether(
  productId: string,
  catalog: RecommendableProduct[],
  coOccurrenceMap: OrderCoOccurrenceMap,
  limit = 6,
): RecommendableProduct[] {
  const neighbors = coOccurrenceMap[productId];
  if (!neighbors) return [];

  const catalogById = new Map(catalog.map((product) => [product.id, product]));

  return Object.entries(neighbors)
    .sort(([, countA], [, countB]) => countB - countA)
    .map(([neighborId]) => catalogById.get(neighborId))
    .filter((product): product is RecommendableProduct => Boolean(product && inStock(product)))
    .slice(0, limit);
}

/**
 * Trending products ranked by reviewCount × rating.
 */
export function trending(
  catalog: RecommendableProduct[],
  limit = 12,
): RecommendableProduct[] {
  return [...catalog]
    .filter(inStock)
    .sort((a, b) => trendingScore(b) - trendingScore(a) || b.reviewCount - a.reviewCount)
    .slice(0, limit);
}

/**
 * Build a co-occurrence map from order item product IDs.
 * Each pair in an order increments both directions.
 */
export function buildCoOccurrenceMap(orderProductIds: string[][]): OrderCoOccurrenceMap {
  const map: OrderCoOccurrenceMap = {};

  for (const productIds of orderProductIds) {
    const uniqueIds = [...new Set(productIds)];
    for (let i = 0; i < uniqueIds.length; i += 1) {
      for (let j = i + 1; j < uniqueIds.length; j += 1) {
        const a = uniqueIds[i];
        const b = uniqueIds[j];
        map[a] = map[a] ?? {};
        map[b] = map[b] ?? {};
        map[a][b] = (map[a][b] ?? 0) + 1;
        map[b][a] = (map[b][a] ?? 0) + 1;
      }
    }
  }

  return map;
}
