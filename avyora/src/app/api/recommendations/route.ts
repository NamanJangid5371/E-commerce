import { products } from "@/data/catalog";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { ensureDb, prisma } from "@/server/db";
import { handleApiError, jsonError, jsonOk } from "@/server/http";
import {
  similarByCategoryMetal,
  trending,
  type RecommendableProduct,
} from "@/server/recommendations/engine";
import { getRecommendations } from "@/server/recommendations/service";
import {
  RECOMMENDATION_CONTEXTS,
  type RecommendationContext,
} from "@/server/recommendations/types";
import { clientIpFromRequest, rateLimit } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";

function toRecommendable(product: {
  legacyId: string | null;
  slug: string;
  name: string;
  metal: string;
  rating: { toNumber(): number } | number;
  reviewCount: number;
  category: { name: string } | null;
  images: { url: string }[];
  variants: { price: { toNumber(): number } | number; salePrice: { toNumber(): number } | null; stock: number }[];
}): RecommendableProduct {
  return {
    id: product.legacyId ?? product.slug,
    slug: product.slug,
    name: product.name,
    category: product.category?.name ?? "",
    metal: product.metal,
    rating: typeof product.rating === "number" ? product.rating : product.rating.toNumber(),
    reviewCount: product.reviewCount,
    images: product.images.map((img) => img.url),
    variants: product.variants.map((v) => ({
      price: typeof v.price === "number" ? v.price : v.price.toNumber(),
      salePrice: v.salePrice != null ? (typeof v.salePrice === "number" ? v.salePrice : v.salePrice.toNumber()) : undefined,
      stock: v.stock,
    })),
  };
}

function catalogFromSeed(): RecommendableProduct[] {
  return products.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category,
    metal: p.metal,
    rating: p.rating,
    reviewCount: p.reviewCount,
    images: p.images,
    variants: p.variants,
  }));
}

function isContext(value: string | null): value is RecommendationContext {
  return Boolean(value && (RECOMMENDATION_CONTEXTS as readonly string[]).includes(value));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const contextParam = url.searchParams.get("context");
    const type = url.searchParams.get("type") ?? (contextParam ? null : "trending");
    const productId = url.searchParams.get("productId");
    const categoryId = url.searchParams.get("categoryId");
    const searchQuery = url.searchParams.get("q") ?? url.searchParams.get("searchQuery");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 8) || 8, 1), 24);
    const anonId = url.searchParams.get("anonId");
    const cartProductIds = (url.searchParams.get("cartIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 40);
    const wishlistProductIds = (url.searchParams.get("wishlistIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 40);

    // Personalized / contextual engine
    if (isContext(contextParam)) {
      const ip = clientIpFromRequest(request) ?? "unknown";
      const limited = rateLimit(`recs:${ip}`, 60, 60_000);
      if (!limited.ok) {
        return jsonError("Too many recommendation requests.", 429);
      }

      await ensureDb();
      const session = await getSessionFromRequest(request);
      const userId = session?.userId ?? null;

      const result = await getRecommendations({
        userId,
        anonId: userId ? null : anonId,
        context: contextParam,
        limit,
        productId,
        categoryId,
        searchQuery,
        cartProductIds,
        wishlistProductIds,
      });

      // Hydrate product cards for the storefront (published + in stock only).
      const ids = result.recommendations.map((r) => r.productId);
      const slugs = result.recommendations.map((r) => r.slug);
      const dbProducts = await prisma.product.findMany({
        where: {
          OR: [{ id: { in: ids } }, { slug: { in: slugs } }],
          status: "PUBLISHED",
          deletedAt: null,
        },
        include: {
          category: { select: { name: true } },
          brand: { select: { name: true } },
          images: { orderBy: { sortOrder: "asc" }, take: 2 },
          variants: true,
        },
      });
      const byId = new Map(dbProducts.map((p) => [p.id, p]));
      const bySlug = new Map(dbProducts.map((p) => [p.slug, p]));

      const recommendations = result.recommendations
        .map((rec) => {
          const p = byId.get(rec.productId) ?? bySlug.get(rec.slug);
          if (!p) return null;
          const stock = p.variants.reduce((s, v) => s + v.stock, 0);
          if (stock <= 0) return null;
          return {
            score: Math.min(1, Math.max(0, rec.score / 50)),
            reason: rec.reasonLabel,
            reasonCode: rec.reasonCode,
            product: {
              id: p.legacyId ?? p.id,
              slug: p.slug,
              name: p.name,
              category: p.category?.name ?? "",
              brand: p.brand?.name ?? "",
              metal: p.metal,
              rating: Number(p.rating),
              reviewCount: p.reviewCount,
              images: p.images.map((img) => img.url),
              featured: p.featured,
              bestSeller: p.bestSeller,
              newArrival: p.newArrival,
              variants: p.variants.map((v) => ({
                sku: v.sku,
                metal: p.metal,
                purity: v.purity,
                colour: v.colour,
                size: v.size ?? undefined,
                stock: v.stock,
                price: Number(v.price),
                salePrice: v.salePrice != null ? Number(v.salePrice) : undefined,
              })),
            },
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row));

      return jsonOk({
        context: result.context,
        strategy: result.strategy,
        recommendations,
      });
    }

    // Legacy similar / trending (kept for existing callers)
    let catalog: RecommendableProduct[] = catalogFromSeed();

    try {
      await ensureDb();
      const dbProducts = await prisma.product.findMany({
        where: { status: "PUBLISHED", deletedAt: null },
        include: {
          category: { select: { name: true } },
          images: { orderBy: { sortOrder: "asc" }, take: 1 },
          variants: true,
        },
      });
      if (dbProducts.length) {
        catalog = dbProducts.map(toRecommendable);
      }
    } catch {
      // Fall back to in-memory catalog when DB is unavailable.
    }

    if (type === "similar") {
      if (!productId) return jsonError("productId is required for type=similar", 400);

      const anchor = catalog.find((p) => p.id === productId || p.slug === productId);
      if (!anchor) return jsonError("Product not found", 404);

      const results = similarByCategoryMetal(anchor, catalog, limit);
      return jsonOk({ type, productId, products: results });
    }

    if (type === "trending") {
      const results = trending(catalog, limit);
      return jsonOk({ type, products: results });
    }

    return jsonError("Provide context=HOME|PRODUCT_PAGE|… or type=similar|trending", 400);
  } catch (error) {
    return handleApiError(error, "recommendations GET");
  }
}
