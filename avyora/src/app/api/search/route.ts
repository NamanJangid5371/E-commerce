import { decimalToNumber } from "@/server/checkout/context";
import { prisma } from "@/server/db";
import {
  dbUnavailableError,
  isDbUnavailable,
  jsonError,
  jsonOk,
} from "@/server/http";
import { logger } from "@/server/logger";
import { productMatchesQuery } from "@/lib/product-search";
import { loadCommerce } from "@/server/commerce-db";
import {
  searchProducts,
  type ProductSearchDocument,
} from "@/server/search/meilisearch";

export const dynamic = "force-dynamic";

async function prismaProductSearch(
  query: string,
  options: {
    limit: number;
    offset: number;
    facets?: string[];
  },
) {
  const q = query.trim();
  const products = await prisma.product.findMany({
    where: {
      status: "PUBLISHED",
      searchable: true,
    },
    include: {
      brand: true,
      category: true,
      variants: { orderBy: { price: "asc" }, take: 1 },
    },
    orderBy: { name: "asc" },
  });

  const mapped: ProductSearchDocument[] = products.map((product) => ({
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    shortDescription: product.shortDescription ?? undefined,
    category: product.category?.name,
    metal: product.metal,
    purity: product.purity,
    colour: product.colour,
    tags: product.tags,
    brand: product.brand?.name,
    price: product.variants[0]
      ? decimalToNumber(product.variants[0].salePrice ?? product.variants[0].price)
      : undefined,
    rating: decimalToNumber(product.rating),
    reviewCount: product.reviewCount,
    featured: product.featured,
    bestSeller: product.bestSeller,
    newArrival: product.newArrival,
    searchable: product.searchable,
  }));

  const matched = q ? mapped.filter((doc) => productMatchesQuery(doc, q)) : mapped;
  const page = matched.slice(options.offset, options.offset + options.limit);

  return {
    hits: page,
    estimatedTotalHits: matched.length,
    fallback: true,
  };
}

function commerceProductSearch(
  query: string,
  options: {
    limit: number;
    offset: number;
  },
) {
  const q = query.trim();
  const catalog = loadCommerce().catalog;
  const mapped: ProductSearchDocument[] = catalog
    .filter((product) => product.status === "published")
    .map((product) => {
      const firstVariant = product.variants[0];

      return {
        id: product.id,
        slug: product.slug,
        name: product.name,
        description: product.description,
        shortDescription: product.story,
        category: product.category,
        metal: product.metal,
        purity: product.purity,
        colour: product.colour,
        tags: product.tags,
        brand: product.brand,
        price:
          typeof firstVariant?.salePrice === "number"
            ? firstVariant.salePrice
            : typeof firstVariant?.price === "number"
              ? firstVariant.price
              : undefined,
        rating: product.rating,
        reviewCount: product.reviewCount,
        featured: product.featured,
        bestSeller: product.bestSeller,
        newArrival: false,
        searchable: true,
      };
    });

  const matched = q ? mapped.filter((doc) => productMatchesQuery(doc, q)) : mapped;
  const page = matched.slice(options.offset, options.offset + options.limit);

  return {
    hits: page,
    estimatedTotalHits: matched.length,
    fallback: true,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const facetsParam = url.searchParams.get("facets");
    const facets = facetsParam
      ? facetsParam.split(",").map((entry) => entry.trim()).filter(Boolean)
      : undefined;
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));

    try {
      const result = await searchProducts(q, { facets, limit, offset });
      if (!result.fallback) {
        return jsonOk(result);
      }
    } catch (error) {
      logger.warn("search.meili_failed", { error: String(error) });
    }

    try {
      const fallback = await prismaProductSearch(q, { limit, offset, facets });
      return jsonOk(fallback);
    } catch (error) {
      if (!isDbUnavailable(error)) {
        throw error;
      }
      logger.warn("search.prisma_fallback_unavailable", { error: String(error) });
      return jsonOk(commerceProductSearch(q, { limit, offset }));
    }
  } catch (error) {
    if (isDbUnavailable(error)) {
      return dbUnavailableError();
    }
    logger.error("search.failed", { error: String(error) });
    return jsonError("Search unavailable.", 500);
  }
}
