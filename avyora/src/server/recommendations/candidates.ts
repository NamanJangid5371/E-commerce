import { prisma } from "@/server/db";
import type { PreferenceProfile } from "@/server/recommendations/profile";
import type { RecommendationContext } from "@/server/recommendations/types";
import { CANDIDATE_LIMIT } from "@/server/recommendations/weights";

export type CandidateProduct = {
  id: string;
  slug: string;
  name: string;
  categoryId: string | null;
  brandId: string | null;
  metal: string;
  featured: boolean;
  bestSeller: boolean;
  newArrival: boolean;
  rating: number;
  reviewCount: number;
  price: number;
  stock: number;
  status: string;
};

function mapRow(p: {
  id: string;
  slug: string;
  name: string;
  categoryId: string | null;
  brandId: string | null;
  metal: string;
  featured: boolean;
  bestSeller: boolean;
  newArrival: boolean;
  rating: { toNumber(): number } | number;
  reviewCount: number;
  status: string;
  variants: { price: { toNumber(): number } | number; salePrice: { toNumber(): number } | null; stock: number }[];
}): CandidateProduct {
  const prices = p.variants.map((v) =>
    Number(v.salePrice != null ? v.salePrice : v.price),
  );
  const stock = p.variants.reduce((s, v) => s + v.stock, 0);
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    categoryId: p.categoryId,
    brandId: p.brandId,
    metal: p.metal,
    featured: p.featured,
    bestSeller: p.bestSeller,
    newArrival: p.newArrival,
    rating: typeof p.rating === "number" ? p.rating : p.rating.toNumber(),
    reviewCount: p.reviewCount,
    price: prices.length ? Math.min(...prices) : 0,
    stock,
    status: p.status,
  };
}

const productSelect = {
  id: true,
  slug: true,
  name: true,
  categoryId: true,
  brandId: true,
  metal: true,
  featured: true,
  bestSeller: true,
  newArrival: true,
  rating: true,
  reviewCount: true,
  status: true,
  variants: { select: { price: true, salePrice: true, stock: true } },
} as const;

/**
 * Build a limited candidate pool — never score the entire catalog.
 */
export async function generateCandidates(input: {
  profile: PreferenceProfile;
  context: RecommendationContext;
  productId?: string | null;
  categoryId?: string | null;
  searchQuery?: string | null;
}): Promise<CandidateProduct[]> {
  const byId = new Map<string, CandidateProduct>();

  const topCategories = Object.entries(input.profile.categoryScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id]) => id);

  if (input.categoryId && !topCategories.includes(input.categoryId)) {
    topCategories.unshift(input.categoryId);
  }

  const baseWhere = {
    status: "PUBLISHED" as const,
    deletedAt: null,
    searchable: true,
  };

  const fetches: Promise<CandidateProduct[]>[] = [];

  if (topCategories.length) {
    fetches.push(
      prisma.product
        .findMany({
          where: { ...baseWhere, categoryId: { in: topCategories } },
          select: productSelect,
          take: 60,
          orderBy: [{ featured: "desc" }, { reviewCount: "desc" }],
        })
        .then((rows) => rows.map(mapRow)),
    );
  }

  fetches.push(
    prisma.product
      .findMany({
        where: { ...baseWhere, OR: [{ bestSeller: true }, { featured: true }, { newArrival: true }] },
        select: productSelect,
        take: 40,
        orderBy: [{ reviewCount: "desc" }, { rating: "desc" }],
      })
      .then((rows) => rows.map(mapRow)),
  );

  if (input.productId) {
    const anchor = await prisma.product.findFirst({
      where: {
        OR: [{ id: input.productId }, { slug: input.productId }, { legacyId: input.productId }],
        deletedAt: null,
      },
      select: { id: true, categoryId: true, metal: true },
    });
    if (anchor?.categoryId) {
      fetches.push(
        prisma.product
          .findMany({
            where: {
              ...baseWhere,
              categoryId: anchor.categoryId,
              id: { not: anchor.id },
              ...(anchor.metal ? { metal: anchor.metal } : {}),
            },
            select: productSelect,
            take: 40,
            orderBy: { reviewCount: "desc" },
          })
          .then((rows) => rows.map(mapRow)),
      );
    }
  }

  if (input.searchQuery?.trim()) {
    const q = input.searchQuery.trim();
    fetches.push(
      prisma.product
        .findMany({
          where: {
            ...baseWhere,
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { tags: { has: q.toLowerCase() } },
              { metal: { contains: q, mode: "insensitive" } },
            ],
          },
          select: productSelect,
          take: 30,
        })
        .then((rows) => rows.map(mapRow)),
    );
  }

  // Popular fallback always
  fetches.push(
    prisma.product
      .findMany({
        where: baseWhere,
        select: productSelect,
        take: 30,
        orderBy: [{ reviewCount: "desc" }, { rating: "desc" }],
      })
      .then((rows) => rows.map(mapRow)),
  );

  const batches = await Promise.all(fetches);
  for (const batch of batches) {
    for (const p of batch) {
      if (p.stock > 0 && p.status === "PUBLISHED") {
        byId.set(p.id, p);
      }
    }
  }

  return [...byId.values()].slice(0, CANDIDATE_LIMIT);
}
