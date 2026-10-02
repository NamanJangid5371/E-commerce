import { Meilisearch, type SearchResponse } from "meilisearch";
import { productMatchesQuery } from "@/lib/product-search";

export const PRODUCT_INDEX = "products";

export type ProductSearchDocument = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  shortDescription?: string;
  category?: string;
  metal?: string;
  purity?: string;
  colour?: string;
  tags?: string[];
  brand?: string;
  price?: number;
  rating?: number;
  reviewCount?: number;
  featured?: boolean;
  bestSeller?: boolean;
  newArrival?: boolean;
  searchable?: boolean;
};

export type SearchProductsOptions = {
  facets?: string[];
  filter?: string;
  limit?: number;
  offset?: number;
  /** In-memory catalog used when Meilisearch is not configured. */
  catalog?: ProductSearchDocument[];
};

export type SearchProductsResult = {
  hits: ProductSearchDocument[];
  estimatedTotalHits: number;
  facetDistribution?: Record<string, Record<string, number>>;
  fallback: boolean;
};

let meiliClient: Meilisearch | null | undefined;

export function getMeiliClient(): Meilisearch | null {
  if (meiliClient !== undefined) return meiliClient;

  const host = process.env.MEILISEARCH_HOST?.trim();
  if (!host) {
    meiliClient = null;
    return null;
  }

  const apiKey = process.env.MEILISEARCH_API_KEY?.trim() || undefined;
  meiliClient = new Meilisearch({ host, apiKey });
  return meiliClient;
}

export async function ensureProductIndex(): Promise<void> {
  const client = getMeiliClient();
  if (!client) return;

  try {
    await client.getIndex(PRODUCT_INDEX);
  } catch {
    await client.createIndex(PRODUCT_INDEX, { primaryKey: "id" });
  }

  const index = client.index(PRODUCT_INDEX);
  await index.updateSettings({
    searchableAttributes: [
      "name",
      "description",
      "shortDescription",
      "category",
      "metal",
      "tags",
      "brand",
      "slug",
    ],
    filterableAttributes: [
      "category",
      "metal",
      "purity",
      "colour",
      "brand",
      "featured",
      "bestSeller",
      "newArrival",
      "searchable",
      "price",
      "rating",
    ],
    sortableAttributes: ["price", "rating", "reviewCount", "name"],
  });
}

export async function indexProduct(doc: ProductSearchDocument): Promise<void> {
  const client = getMeiliClient();
  if (!client) return;

  await ensureProductIndex();
  await client.index(PRODUCT_INDEX).addDocuments([doc]);
}

export async function removeProduct(id: string): Promise<void> {
  const client = getMeiliClient();
  if (!client) return;

  await client.index(PRODUCT_INDEX).deleteDocument(id);
}

function matchesSimpleFilter(doc: ProductSearchDocument, filter?: string): boolean {
  if (!filter?.trim()) return true;

  const clauses = filter.split(/\s+AND\s+/i).map((part) => part.trim());
  return clauses.every((clause) => {
    const eqMatch = clause.match(/^(\w+)\s*=\s*"?([^"]+)"?$/);
    if (!eqMatch) return true;

    const [, field, value] = eqMatch;
    const docValue = doc[field as keyof ProductSearchDocument];
    if (Array.isArray(docValue)) {
      return docValue.some((entry) => String(entry).toLowerCase() === value.toLowerCase());
    }
    return String(docValue ?? "").toLowerCase() === value.toLowerCase();
  });
}

function searchCatalogFallback(
  query: string,
  options: SearchProductsOptions,
): SearchProductsResult {
  const catalog = (options.catalog ?? []).filter((doc) => doc.searchable !== false);

  let hits = catalog;
  if (query.trim()) {
    hits = catalog.filter((doc) => productMatchesQuery(doc, query));
  }

  hits = hits.filter((doc) => matchesSimpleFilter(doc, options.filter));

  const offset = options.offset ?? 0;
  const limit = options.limit ?? 20;
  const page = hits.slice(offset, offset + limit);

  return {
    hits: page,
    estimatedTotalHits: hits.length,
    fallback: true,
  };
}

export async function searchProducts(
  query: string,
  options: SearchProductsOptions = {},
): Promise<SearchProductsResult> {
  const client = getMeiliClient();
  if (!client) {
    return searchCatalogFallback(query, options);
  }

  await ensureProductIndex();

  const index = client.index(PRODUCT_INDEX);
  const response = (await index.search(query, {
    limit: Math.max(options.limit ?? 20, 40),
    offset: options.offset ?? 0,
    filter: options.filter,
    facets: options.facets,
  })) as SearchResponse<ProductSearchDocument>;

  // Post-filter so Meili hits don't confuse ring vs earring, etc.
  const filtered = query.trim()
    ? response.hits.filter((doc) => productMatchesQuery(doc, query))
    : response.hits;
  const limit = options.limit ?? 20;
  const hits = filtered.slice(0, limit);

  return {
    hits,
    estimatedTotalHits: filtered.length,
    facetDistribution: response.facetDistribution,
    fallback: false,
  };
}
