"use client";

import { ProductGrid } from "@/components/product-card";
import { variantStock } from "@/data/catalog";
import type { Metal, Product } from "@/data/types";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useLiveCatalog, useShopStore } from "@/store/shop-store";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

function CollectionFilters({ products }: { products: Product[] }) {
  const { collections } = useLiveCatalog();
  const ops = useShopStore((s) => s.ops);
  const shopCategories = useMemo(
    () =>
      [...(ops?.categories ?? [])]
        .filter((c) => c.enabled)
        .sort((a, b) => a.order - b.order)
        .map((c) => c.name),
    [ops?.categories],
  );

  const [category, setCategory] = useState("All");
  const [metal, setMetal] = useState<string>("All");
  const [sort, setSort] = useState("featured");
  const [maxPrice, setMaxPrice] = useState(350000);
  const [inStock, setInStock] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const categoriesInCollection = useMemo(() => {
    const present = new Set(products.map((p) => p.category));
    return ["All", ...shopCategories.filter((c) => present.has(c))];
  }, [products, shopCategories]);

  const list = useMemo(() => {
    let next = [...products];
    if (category !== "All") next = next.filter((p) => p.category === category);
    if (metal !== "All") next = next.filter((p) => p.metal === metal);
    next = next.filter((p) => {
      const price = Math.min(...p.variants.map((v) => v.salePrice ?? v.price));
      return price <= maxPrice;
    });
    if (inStock) next = next.filter((p) => variantStock(p) > 0);
    if (sort === "new") next = next.filter((p) => p.newArrival).concat(next.filter((p) => !p.newArrival));
    if (sort === "price-asc") {
      next.sort(
        (a, b) =>
          Math.min(...a.variants.map((v) => v.salePrice ?? v.price)) -
          Math.min(...b.variants.map((v) => v.salePrice ?? v.price)),
      );
    }
    if (sort === "price-desc") {
      next.sort(
        (a, b) =>
          Math.min(...b.variants.map((v) => v.salePrice ?? v.price)) -
          Math.min(...a.variants.map((v) => v.salePrice ?? v.price)),
      );
    }
    if (sort === "best") next.sort((a, b) => Number(b.bestSeller) - Number(a.bestSeller) || b.rating - a.rating);
    return next;
  }, [products, category, metal, sort, maxPrice, inStock]);

  return (
    <div className="mt-8 grid items-start gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <button
        type="button"
        className="min-h-11 border border-line px-4 py-2 text-[11px] tracking-[0.16em] uppercase lg:hidden"
        onClick={() => setFiltersOpen((open) => !open)}
      >
        {filtersOpen ? "Hide filters" : "Filters"}
      </button>
      <aside className={cn("h-fit space-y-6 border border-line bg-ivory/60 p-5 text-sm lg:sticky lg:top-28", filtersOpen ? "block" : "hidden lg:block")}>
        {categoriesInCollection.length > 2 && (
          <div>
            <p className="text-[11px] tracking-[0.2em] uppercase text-gold-deep">Category</p>
            <div className="mt-4 flex flex-col gap-1.5">
              {categoriesInCollection.map((c) => {
                const selected = category === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={cn(
                      "flex items-center rounded-xl px-3 py-2.5 text-left transition-all duration-200",
                      selected
                        ? "bg-primary text-background font-medium"
                        : "text-ink-soft hover:bg-accent hover:text-primary",
                    )}
                  >
                    <span
                      className={cn(
                        "mr-2.5 inline-block h-1.5 w-1.5 rounded-full transition-colors duration-200",
                        selected ? "bg-secondary" : "bg-line",
                      )}
                    />
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <p className="text-[11px] tracking-[0.2em] uppercase text-gold-deep">Metal</p>
          <div className="mt-4 flex flex-col gap-1.5">
            {["All", "Gold", "Silver", "Platinum"].map((m) => {
              const selected = metal === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMetal(m as Metal | "All")}
                  className={cn(
                    "flex items-center rounded-xl px-3 py-2.5 text-left transition-all duration-200",
                    selected
                      ? "bg-primary text-background font-medium"
                      : "text-ink-soft hover:bg-accent hover:text-primary",
                  )}
                >
                  <span
                    className={cn(
                      "mr-2.5 inline-block h-1.5 w-1.5 rounded-full transition-colors duration-200",
                      selected ? "bg-secondary" : "bg-line",
                    )}
                  />
                  {m}
                </button>
              );
            })}
          </div>
        </div>

        <div className="gold-line" />

        <div>
          <p className="text-[11px] tracking-[0.2em] uppercase text-gold-deep">Price up to</p>
          <input
            type="range"
            min={5000}
            max={350000}
            step={1000}
            value={maxPrice}
            onChange={(e) => setMaxPrice(Number(e.target.value))}
            className="mt-4 w-full accent-[var(--gold-deep)]"
          />
          <p className="mt-2 font-serif text-xl text-ink">{formatINR(maxPrice)}</p>
        </div>

        <label className="flex items-center gap-2 text-ink-soft">
          <input
            type="checkbox"
            checked={inStock}
            onChange={(e) => setInStock(e.target.checked)}
            className="accent-[var(--gold-deep)]"
          />
          In stock only
        </label>

        <div className="gold-line" />

        <div>
          <p className="text-[11px] tracking-[0.2em] uppercase text-gold-deep">Other collections</p>
          <div className="mt-4 flex flex-col gap-1.5">
            {collections.map((c) => (
              <Link
                key={c.slug}
                href={`/collections/${c.slug}`}
                className="rounded-xl px-3 py-2.5 text-ink-soft transition-all duration-200 hover:bg-accent hover:text-primary"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      </aside>

      <div>
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <p className="font-serif text-2xl tracking-tight">
            Showing <span className="text-gold-deep">{list.length}</span> pieces
          </p>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="border border-line bg-transparent px-3 py-2 text-sm"
          >
            <option value="featured">Featured</option>
            <option value="new">New arrivals</option>
            <option value="best">Bestsellers</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </select>
        </div>
        {list.length ? (
          <ProductGrid products={list} className="xl:grid-cols-3" />
        ) : (
          <p className="border border-line bg-paper/50 px-4 py-10 text-sm text-ink-soft">
            No pieces match these filters in this collection.
          </p>
        )}
      </div>
    </div>
  );
}

export default function CollectionPage() {
  const { slug } = useParams<{ slug: string }>();
  const { products, collections } = useLiveCatalog();
  const collection = collections.find((c) => c.slug === slug);

  if (!collection) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-3xl font-medium tracking-tight">Collection not found</h1>
        <Link href="/shop" className="mt-6 inline-block text-sm underline">
          Shop jewellery
        </Link>
      </div>
    );
  }

  const assigned = (
    collection.productSlugs.length
      ? collection.productSlugs.map((s) => products.find((p) => p.slug === s)).filter(Boolean)
      : products.filter((p) => p.collection === collection.slug)
  ) as typeof products;

  return (
    <div>
      <section className="relative h-[48vh] min-h-[320px]">
        <Image
          key={collection.image}
          src={collection.image}
          alt={collection.name}
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-primary/55" />
        <div className="relative flex h-full flex-col justify-end px-4 pb-12 text-background">
          <div className="mx-auto w-full max-w-7xl">
            <p className="text-[11px] tracking-[0.24em] uppercase text-secondary">Collection</p>
            <h1 className="mt-2 font-serif text-6xl">{collection.name}</h1>
            <p className="mt-3 max-w-lg text-sm text-background/85">{collection.tagline}</p>
            {collection.slug === "atelier" && (
              <Link href="/visit" className="btn-secondary on-dark mt-6 w-fit">
                Book a viewing
              </Link>
            )}
          </div>
        </div>
      </section>
      <div className="mx-auto max-w-7xl px-4 py-16">
        <p className="max-w-2xl text-sm leading-7 text-ink-soft">{collection.description}</p>
        <CollectionFilters products={assigned} />
      </div>
    </div>
  );
}
