import type { HomepageSection } from "@/data/admin-ops";
import type { Product } from "@/data/types";

export const HOMEPAGE_PRODUCT_SECTIONS = ["bestsellers", "arrivals", "featured"] as const;
export type HomepageProductSectionId = (typeof HOMEPAGE_PRODUCT_SECTIONS)[number];

export const HOMEPAGE_SECTION_LIMITS: Record<HomepageProductSectionId, number> = {
  bestsellers: 3,
  arrivals: 3,
  featured: 8,
};

export const HOMEPAGE_SECTION_LABELS: Record<HomepageProductSectionId, string> = {
  bestsellers: "Signature pieces",
  arrivals: "New arrivals",
  featured: "Curated selection",
};

function takeUnique(lists: Product[][], limit: number): Product[] {
  const out: Product[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const product of list) {
      if (!product?.id || seen.has(product.id)) continue;
      seen.add(product.id);
      out.push(product);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function resolveSectionProducts(
  sectionId: HomepageProductSectionId,
  sections: HomepageSection[],
  products: Product[],
  fallback: Product[],
  limit: number,
): Product[] {
  const ids = sections.find((s) => s.id === sectionId)?.productIds?.filter(Boolean) ?? [];
  if (ids.length === 0) return fallback.slice(0, limit);

  const byId = new Map(products.map((p) => [p.id, p]));
  return ids
    .map((id) => byId.get(id))
    .filter((p): p is Product => Boolean(p))
    .slice(0, limit);
}

export function buildHomepageProductSets(sections: HomepageSection[], products: Product[]) {
  const featured = products.filter((p) => p.featured);
  const bestsellers = products.filter((p) => p.bestSeller);
  const arrivals = products.filter((p) => p.newArrival);

  const signatureFallback = bestsellers.length ? bestsellers : arrivals;
  const signatureResolved = resolveSectionProducts(
    "bestsellers",
    sections,
    products,
    signatureFallback,
    HOMEPAGE_SECTION_LIMITS.bestsellers,
  );

  const manualSignature = (sections.find((s) => s.id === "bestsellers")?.productIds?.length ?? 0) > 0;
  const heroProduct =
    signatureResolved[0] ?? featured[0] ?? bestsellers[0] ?? products[0] ?? null;
  const sideProducts = manualSignature
    ? signatureResolved.slice(1, HOMEPAGE_SECTION_LIMITS.bestsellers)
    : signatureFallback.filter((p) => p.id !== heroProduct?.id).slice(0, 2);

  const finalHero = manualSignature ? (signatureResolved[0] ?? heroProduct) : heroProduct;
  const finalSide = manualSignature ? signatureResolved.slice(1, 3) : sideProducts;

  const signatureIds = new Set(
    [finalHero?.id, ...finalSide.map((p) => p.id)].filter(Boolean) as string[],
  );

  const arrivalsPool = arrivals.length ? arrivals : products;
  const gridProducts = takeUnique(
    [
      resolveSectionProducts(
        "arrivals",
        sections,
        products,
        arrivalsPool,
        HOMEPAGE_SECTION_LIMITS.arrivals,
      ),
      arrivalsPool,
      products,
    ],
    HOMEPAGE_SECTION_LIMITS.arrivals,
  );

  const gridIds = new Set(gridProducts.map((p) => p.id));
  const curatedFallback = featured.filter((p) => !signatureIds.has(p.id) && !gridIds.has(p.id));
  const curatedProducts = resolveSectionProducts(
    "featured",
    sections,
    products,
    curatedFallback,
    HOMEPAGE_SECTION_LIMITS.featured,
  ).filter((p) => !signatureIds.has(p.id) && !gridIds.has(p.id));

  return {
    heroProduct: finalHero,
    sideProducts: finalSide,
    gridProducts,
    curatedProducts,
  };
}
