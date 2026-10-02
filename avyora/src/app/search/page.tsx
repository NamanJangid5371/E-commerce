"use client";

import { PersonalizedRecommendations } from "@/components/personalized-recommendations";
import { ProductGrid } from "@/components/product-card";
import { productMatchesQuery } from "@/lib/product-search";
import { trackEvent } from "@/lib/track-event";
import { useLiveCatalog, useShopStore } from "@/store/shop-store";
import { Suspense, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

function SearchInner() {
  const { products } = useLiveCatalog();
  const logSearch = useShopStore((s) => s.logSearch);
  const params = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const list = useMemo(() => {
    const visible = products.filter((p) => p.searchable !== false);
    if (!q) return visible;
    return visible.filter((p) =>
      productMatchesQuery(
        {
          name: p.name,
          shortDescription: p.shortDescription,
          description: p.description,
          category: p.category,
          collection: p.collection,
          metal: p.metal,
          stone: p.stone,
          slug: p.slug,
          tags: p.tags,
        },
        q,
      ),
    );
  }, [q, products]);

  useEffect(() => {
    if (q) {
      logSearch(q.toLowerCase(), list.length);
      trackEvent({ eventType: "SEARCH", searchQuery: q.slice(0, 120) });
    }
  }, [q, list.length, logSearch]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-16">
      <h1 className="text-4xl font-medium tracking-tight">Search</h1>
      <p className="mt-2 text-sm text-ink-soft">
        {q ? `Results for “${q}” · ${list.length} pieces` : "Browse the full atelier."}
      </p>
      <div className="mt-12">
        <ProductGrid products={list} />
      </div>
      {q ? (
        <PersonalizedRecommendations
          context="SEARCH"
          kicker="Also consider"
          title="Based on your search"
          searchQuery={q}
          className="mt-20"
          limit={8}
        />
      ) : null}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchInner />
    </Suspense>
  );
}
