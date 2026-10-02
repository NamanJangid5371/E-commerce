"use client";

import { ProductCard } from "@/components/product-card";
import type { Product } from "@/data/types";
import { fetchJson, isApiOffline } from "@/lib/api-client";
import { getAnonId, trackEvent } from "@/lib/track-event";
import { useShopStore } from "@/store/shop-store";
import { useEffect, useMemo, useRef, useState } from "react";

type RecContext =
  | "HOME"
  | "PRODUCT_PAGE"
  | "CART"
  | "CHECKOUT"
  | "SEARCH"
  | "WISHLIST"
  | "POST_PURCHASE";

type ApiRec = {
  score: number;
  reason: string;
  reasonCode: string;
  product: Partial<Product> & {
    id: string;
    slug: string;
    name: string;
    images: string[];
    variants: Product["variants"];
  };
};

type ApiPayload = {
  context: RecContext;
  strategy: string;
  recommendations: ApiRec[];
};

function toProduct(raw: ApiRec["product"], catalog: Product[]): Product | null {
  const fromCatalog =
    catalog.find((p) => p.id === raw.id || p.slug === raw.slug) ??
    catalog.find((p) => p.slug === raw.slug);
  if (fromCatalog) return fromCatalog;
  if (!raw.variants?.length) return null;
  return {
    id: raw.id,
    sku: raw.variants[0]?.sku ?? raw.slug,
    slug: raw.slug,
    name: raw.name,
    brand: raw.brand ?? "Avyora",
    category: (raw.category as Product["category"]) || "Jewellery",
    collection: "",
    tags: [],
    description: "",
    story: "",
    metal: (raw.metal as Product["metal"]) || "Gold",
    purity: raw.variants[0]?.purity ?? "",
    colour: raw.variants[0]?.colour ?? "",
    weight: "",
    dimensions: "",
    makingCharge: 0,
    taxNote: "",
    images: raw.images?.length ? raw.images : ["/images/placeholder.jpg"],
    certificateNumber: "",
    certifiedBy: "",
    warranty: "",
    care: "",
    returnPolicy: "",
    seoTitle: raw.name,
    seoDescription: "",
    rating: raw.rating ?? 0,
    reviewCount: raw.reviewCount ?? 0,
    reviews: [],
    variants: raw.variants,
    featured: raw.featured,
    bestSeller: raw.bestSeller,
    newArrival: raw.newArrival,
  };
}

export function RecommendationCard({
  product,
  reason,
  context,
}: {
  product: Product;
  reason?: string;
  context: RecContext;
}) {
  return (
    <div
      onClickCapture={() =>
        trackEvent({
          eventType: "RECOMMENDATION_CLICK",
          productId: product.id,
          metadata: { context },
        })
      }
    >
      <ProductCard product={product} />
      {reason ? (
        <p className="mt-2 text-[11px] tracking-wide text-ink-soft">{reason}</p>
      ) : null}
    </div>
  );
}

export function RecommendationCarousel({
  products,
  reasons,
  context,
}: {
  products: Product[];
  reasons: string[];
  context: RecContext;
}) {
  if (!products.length) return null;
  return (
    <div className="mt-6 grid grid-cols-2 items-start gap-x-4 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:gap-x-6 xl:grid-cols-4">
      {products.map((product, i) => (
        <RecommendationCard
          key={product.id}
          product={product}
          reason={reasons[i]}
          context={context}
        />
      ))}
    </div>
  );
}

export function RecommendationSection({
  context,
  title,
  kicker,
  productId,
  categoryId,
  searchQuery,
  limit = 8,
  className,
}: {
  context: RecContext;
  title: string;
  kicker?: string;
  productId?: string;
  categoryId?: string;
  searchQuery?: string;
  limit?: number;
  className?: string;
}) {
  const catalog = useShopStore((s) => s.catalog);
  const cart = useShopStore((s) => s.cart);
  const wishlist = useShopStore((s) => s.wishlist);
  const [items, setItems] = useState<{ product: Product; reason: string }[]>([]);
  const [sectionTitle, setSectionTitle] = useState(title);
  const impressed = useRef(false);

  const cartIds = useMemo(() => [...new Set(cart.map((c) => c.productId))].join(","), [cart]);
  const wishlistIds = useMemo(() => wishlist.join(","), [wishlist]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const params = new URLSearchParams({
        context,
        limit: String(limit),
        anonId: getAnonId(),
      });
      if (productId) params.set("productId", productId);
      if (categoryId) params.set("categoryId", categoryId);
      if (searchQuery) params.set("q", searchQuery);
      if (cartIds) params.set("cartIds", cartIds);
      if (wishlistIds) params.set("wishlistIds", wishlistIds);

      const res = await fetchJson<ApiPayload>(`/api/recommendations?${params.toString()}`);
      if (cancelled || !res.ok || isApiOffline(res)) return;
      const mapped = res.data.recommendations
        .map((row) => {
          const product = toProduct(row.product, catalog);
          if (!product) return null;
          return { product, reason: row.reason };
        })
        .filter((row): row is { product: Product; reason: string } => Boolean(row));
      setItems(mapped);
      if (mapped[0]?.reason) {
        setSectionTitle(title);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [context, productId, categoryId, searchQuery, limit, cartIds, wishlistIds, catalog, title]);

  useEffect(() => {
    if (!items.length || impressed.current) return;
    impressed.current = true;
    for (const item of items.slice(0, 8)) {
      trackEvent({
        eventType: "RECOMMENDATION_IMPRESSION",
        productId: item.product.id,
        metadata: { context },
      });
    }
  }, [items, context]);

  if (!items.length) return null;

  return (
    <section className={className ?? "mt-20"}>
      {kicker ? <p className="section-kicker">{kicker}</p> : null}
      {kicker ? <div className="gold-rule mt-3" /> : null}
      <h2 className={`section-title ${kicker ? "mt-4" : "mt-0"}`}>{sectionTitle}</h2>
      <RecommendationCarousel
        products={items.map((i) => i.product)}
        reasons={context === "HOME" || context === "CART" ? [] : items.map((i) => i.reason)}
        context={context}
      />
    </section>
  );
}

/** Alias matching the planned public API. */
export function PersonalizedRecommendations(props: {
  context: RecContext;
  title?: string;
  kicker?: string;
  productId?: string;
  categoryId?: string;
  searchQuery?: string;
  limit?: number;
  className?: string;
}) {
  return (
    <RecommendationSection
      context={props.context}
      title={props.title ?? "Picked for you"}
      kicker={props.kicker}
      productId={props.productId}
      categoryId={props.categoryId}
      searchQuery={props.searchQuery}
      limit={props.limit}
      className={props.className}
    />
  );
}
