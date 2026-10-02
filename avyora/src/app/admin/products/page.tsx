"use client";

import type { CategoryRecord } from "@/data/admin-ops";
import type { Collection, Product } from "@/data/types";
import { variantStock } from "@/data/catalog";
import { formatINR } from "@/lib/format";
import { MEDIA_LIBRARY, slugify } from "@/lib/media";
import { persistCommerceNow } from "@/components/providers";
import { useShopStore } from "@/store/shop-store";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState, Suspense } from "react";

const emptyCollection = (): Collection => ({
  slug: "",
  name: "",
  tagline: "",
  description: "",
  image: MEDIA_LIBRARY[6],
  productSlugs: [],
});

function productCategoryId(p: Product, categories: CategoryRecord[]) {
  if (p.categoryId) return p.categoryId;
  return categories.find((c) => c.name === p.category)?.id;
}

function categoryOrderIndex(id: string | undefined, categories: CategoryRecord[]) {
  if (!id) return 9999;
  const idx = categories.findIndex((c) => c.id === id);
  return idx === -1 ? 9998 : categories[idx].order;
}

function productCollectionSlugs(p: Product, collections: { slug: string; productSlugs: string[] }[]) {
  const fromLists = collections.filter((c) => c.productSlugs.includes(p.slug)).map((c) => c.slug);
  if (fromLists.length) return fromLists;
  if (p.collection) return [p.collection];
  return [];
}

function productInCollection(
  p: Product,
  collectionSlug: string,
  collections: { slug: string; productSlugs: string[] }[],
) {
  if (collectionSlug === "all") return true;
  const col = collections.find((c) => c.slug === collectionSlug);
  if (col?.productSlugs.includes(p.slug)) return true;
  return p.collection === collectionSlug;
}

export default function AdminProductsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-ink-soft">Loading products…</div>}>
      <AdminProducts />
    </Suspense>
  );
}

function AdminProducts() {
  const catalog = useShopStore((s) => s.catalog);
  const ops = useShopStore((s) => s.ops);
  const deleteProduct = useShopStore((s) => s.deleteProduct);
  const upsertProduct = useShopStore((s) => s.upsertProduct);
  const importCatalog = useShopStore((s) => s.importCatalog);
  const resetCatalog = useShopStore((s) => s.resetCatalog);
  const collections = useShopStore((s) => s.collections);
  const addProductsToCollection = useShopStore((s) => s.addProductsToCollection);
  const removeProductsFromCollection = useShopStore((s) => s.removeProductsFromCollection);
  const upsertCollection = useShopStore((s) => s.upsertCollection);
  const deleteCollection = useShopStore((s) => s.deleteCollection);
  const coupons = useShopStore((s) => s.coupons);

  const categories = useMemo(
    () => [...(ops?.categories ?? [])].sort((a, b) => a.order - b.order),
    [ops?.categories],
  );

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [categoryId, setCategoryId] = useState("all");
  const [collectionSlug, setCollectionSlug] = useState("all");
  const [bulkCollection, setBulkCollection] = useState("");
  const [showManageCollections, setShowManageCollections] = useState(false);
  const [collectionForm, setCollectionForm] = useState<Collection>(emptyCollection);
  const [expandedCollectionSlug, setExpandedCollectionSlug] = useState<string | null>(null);
  const [collectionProductQ, setCollectionProductQ] = useState("");
  const searchParams = useSearchParams();

  useEffect(() => {
    setCategoryId(searchParams.get("category") ?? "all");
    setCollectionSlug(searchParams.get("collection") ?? "all");
    setShowManageCollections(searchParams.get("manageCollections") === "1");
  }, [searchParams]);
  const [sort, setSort] = useState<"name" | "category" | "status" | "price">("category");
  const [selected, setSelected] = useState<string[]>([]);

  const categoryStats = useMemo(() => {
    return categories.map((c) => {
      const items = catalog.filter((p) => productCategoryId(p, categories) === c.id);
      return {
        ...c,
        total: items.length,
        published: items.filter((p) => (p.status ?? "published") === "published").length,
        drafts: items.filter((p) => (p.status ?? "published") === "draft").length,
      };
    });
  }, [catalog, categories]);

  const collectionStats = useMemo(() => {
    return collections.map((c) => {
      const items = catalog.filter((p) => productInCollection(p, c.slug, collections));
      return { ...c, total: items.length };
    });
  }, [catalog, collections]);

  async function saveCollection(e: FormEvent) {
    e.preventDefault();
    const slug = collectionForm.slug || slugify(collectionForm.name);
    const productSlugs = [...new Set(collectionForm.productSlugs)];
    const previous = collections.find((c) => c.slug === slug);
    upsertCollection({ ...collectionForm, slug, productSlugs });

    catalog.forEach((p) => {
      const shouldInclude = productSlugs.includes(p.slug);
      const wasIn = previous?.productSlugs.includes(p.slug) || p.collection === slug;
      if (shouldInclude && !wasIn) addProductsToCollection([p.id], slug);
      if (!shouldInclude && wasIn) removeProductsFromCollection([p.id], slug);
    });

    try {
      await persistCommerceNow();
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Could not save collection to the server. Sign in again at /staff-login, then retry.",
      );
      return;
    }

    setCollectionForm(emptyCollection());
    setCollectionProductQ("");
    setExpandedCollectionSlug(null);
  }

  function editCollection(c: Collection) {
    const assigned = catalog.filter((p) => productInCollection(p, c.slug, collections)).map((p) => p.slug);
    setCollectionForm({ ...c, productSlugs: [...new Set([...c.productSlugs, ...assigned])] });
    setShowManageCollections(true);
    setExpandedCollectionSlug(c.slug);
  }

  function startNewCollection() {
    setCollectionForm(emptyCollection());
    setExpandedCollectionSlug(null);
    setCollectionProductQ("");
    setShowManageCollections(true);
  }

  function toggleFormProduct(productSlug: string, checked: boolean) {
    setCollectionForm((form) => ({
      ...form,
      productSlugs: checked
        ? [...new Set([...form.productSlugs, productSlug])]
        : form.productSlugs.filter((s) => s !== productSlug),
    }));
  }

  const formProducts = useMemo(() => {
    const needle = collectionProductQ.trim().toLowerCase();
    return catalog.filter((p) => !needle || `${p.name} ${p.sku}`.toLowerCase().includes(needle));
  }, [catalog, collectionProductQ]);

  function removeCollection(slug: string) {
    const col = collections.find((c) => c.slug === slug);
    if (!col) return;
    if (!confirm(`Remove "${col.name}" collection? Products stay in the catalogue.`)) return;
    deleteCollection(slug);
    if (collectionSlug === slug) setCollectionSlug("all");
    if (collectionForm.slug === slug) setCollectionForm(emptyCollection());
    if (expandedCollectionSlug === slug) setExpandedCollectionSlug(null);
  }

  const list = useMemo(() => {
    let next = catalog.filter((p) => {
      const matchQ = !q || `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(q.toLowerCase());
      const matchS = status === "all" || (p.status ?? "published") === status;
      const pid = productCategoryId(p, categories);
      const matchC =
        categoryId === "all" ||
        (categoryId === "__unassigned__"
          ? !categories.some((c) => c.id === pid)
          : pid === categoryId);
      const matchCol = productInCollection(p, collectionSlug, collections);
      return matchQ && matchS && matchC && matchCol;
    });

    if (sort === "name") next.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "category") {
      next.sort((a, b) => {
        const oa = categoryOrderIndex(productCategoryId(a, categories), categories);
        const ob = categoryOrderIndex(productCategoryId(b, categories), categories);
        if (oa !== ob) return oa - ob;
        return a.name.localeCompare(b.name);
      });
    }
    if (sort === "status") {
      const rank = (s?: string) => (s === "draft" ? 0 : s === "published" ? 1 : 2);
      next.sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));
    }
    if (sort === "price") {
      next.sort(
        (a, b) =>
          Math.min(...a.variants.map((v) => v.salePrice ?? v.price)) -
          Math.min(...b.variants.map((v) => v.salePrice ?? v.price)),
      );
    }
    return next;
  }, [catalog, q, status, categoryId, collectionSlug, sort, categories, collections]);

  function exportJson() {
    const blob = new Blob([JSON.stringify({ catalog, collections, coupons }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "avyora-catalog.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (Array.isArray(data.catalog)) importCatalog(data);
      } catch {
        alert("Invalid catalogue file.");
      }
    };
    reader.readAsText(file);
  }

  function publishProducts(ids: string[]) {
    ids.forEach((id) => {
      const p = catalog.find((x) => x.id === id);
      if (p) upsertProduct({ ...p, status: "published" });
    });
    setSelected([]);
  }

  function launchCategory(catId: string) {
    const drafts = catalog.filter(
      (p) => productCategoryId(p, categories) === catId && (p.status ?? "published") === "draft",
    );
    if (!drafts.length) return;
    if (!confirm(`Publish ${drafts.length} draft product(s) in this category?`)) return;
    publishProducts(drafts.map((p) => p.id));
  }

  const activeCategory = categories.find((c) => c.id === categoryId);
  const activeCollection = collections.find((c) => c.slug === collectionSlug);
  const filtersActive = categoryId !== "all" || collectionSlug !== "all" || status !== "all" || q.trim().length > 0;

  const unassignedCount = useMemo(
    () => catalog.filter((p) => !categories.some((c) => c.id === productCategoryId(p, categories))).length,
    [catalog, categories],
  );

  function clearFilters() {
    setCategoryId("all");
    setCollectionSlug("all");
    setStatus("all");
    setQ("");
    setSelected([]);
  }

  function toggleCollectionProduct(slug: string, productSlug: string, checked: boolean) {
    const product = catalog.find((p) => p.slug === productSlug);
    if (!product) return;
    if (checked) addProductsToCollection([product.id], slug);
    else removeProductsFromCollection([product.id], slug);
  }

  function assignSelectedToCollection(action: "add" | "remove") {
    if (!bulkCollection || !selected.length) return;
    if (action === "add") addProductsToCollection(selected, bulkCollection);
    else removeProductsFromCollection(selected, bulkCollection);
    setSelected([]);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium tracking-tight">Products</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Manage products and collections in one place — filter, assign, publish, and group for the storefront.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowManageCollections((v) => !v)}
            className={`border px-4 py-2 text-xs uppercase tracking-widest ${
              showManageCollections ? "border-ink bg-paper" : "border-line"
            }`}
          >
            {showManageCollections ? "Hide collections" : "Manage collections"}
          </button>
          <button onClick={exportJson} className="border border-line px-4 py-2 text-xs uppercase tracking-widest">
            Export JSON
          </button>
          <label className="border border-line px-4 py-2 text-xs uppercase tracking-widest">
            Import JSON
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
            />
          </label>
          <button onClick={resetCatalog} className="border border-line px-4 py-2 text-xs uppercase tracking-widest">
            Restore seed
          </button>
          <Link
            href="/admin/products/new"
            className="rounded-[var(--radius)] bg-ink px-4 py-2 text-xs uppercase tracking-widest text-ivory transition hover:bg-ink/90"
          >
            Add product
          </Link>
        </div>
      </div>

      {showManageCollections && (
        <div className="mt-8 space-y-6 border border-line bg-ivory/50 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-medium tracking-tight">Collections</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Add, edit, or remove any collection — seed or custom. Assign products below or from the product list.
              </p>
            </div>
            <button
              type="button"
              onClick={startNewCollection}
              className="bg-ink px-4 py-2 text-xs uppercase tracking-widest text-ivory"
            >
              + New collection
            </button>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
            <div className="border border-line bg-paper p-5">
              <h3 className="font-medium">
                {collectionForm.name ? `Editing: ${collectionForm.name}` : "Create collection"}
              </h3>
              <form onSubmit={saveCollection} className="mt-4 space-y-3">
                <input
                  required
                  placeholder="Collection name"
                  value={collectionForm.name}
                  onChange={(e) =>
                    setCollectionForm({ ...collectionForm, name: e.target.value, slug: slugify(e.target.value) })
                  }
                  className="w-full border border-line bg-transparent px-3 py-2 text-sm"
                />
                <input
                  placeholder="URL slug"
                  value={collectionForm.slug}
                  onChange={(e) => setCollectionForm({ ...collectionForm, slug: slugify(e.target.value) })}
                  className="w-full border border-line bg-transparent px-3 py-2 text-sm"
                />
                <input
                  placeholder="Tagline"
                  value={collectionForm.tagline}
                  onChange={(e) => setCollectionForm({ ...collectionForm, tagline: e.target.value })}
                  className="w-full border border-line bg-transparent px-3 py-2 text-sm"
                />
                <textarea
                  placeholder="Description for storefront collection page"
                  value={collectionForm.description}
                  onChange={(e) => setCollectionForm({ ...collectionForm, description: e.target.value })}
                  className="min-h-20 w-full border border-line bg-transparent px-3 py-2 text-sm"
                />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-gold-deep">
                    Collection page image
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    Hero banner on /collections/{collectionForm.slug || "…"}
                  </p>
                  <input
                    value={collectionForm.image}
                    onChange={(e) => setCollectionForm({ ...collectionForm, image: e.target.value })}
                    placeholder="/products/ring-5.jpg or https://…"
                    className="mt-2 w-full border border-line bg-transparent px-3 py-2 text-sm"
                  />
                  {collectionForm.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={collectionForm.image}
                      alt=""
                      className="mt-2 h-28 w-full max-w-sm object-cover border border-line"
                    />
                  ) : null}
                  <div className="mt-2 grid max-h-36 grid-cols-5 gap-1.5 overflow-auto sm:grid-cols-6">
                    {MEDIA_LIBRARY.map((src) => (
                      <button
                        key={src}
                        type="button"
                        onClick={() => setCollectionForm({ ...collectionForm, image: src })}
                        className={`relative aspect-square overflow-hidden border ${
                          collectionForm.image === src ? "border-ink" : "border-line hover:border-ink"
                        }`}
                        title={src}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-gold-deep">
                      Products in this collection
                    </p>
                    <span className="text-xs text-ink-soft">{collectionForm.productSlugs.length} selected</span>
                  </div>
                  <input
                    value={collectionProductQ}
                    onChange={(e) => setCollectionProductQ(e.target.value)}
                    placeholder="Search products…"
                    className="mt-2 w-full border border-line bg-transparent px-3 py-2 text-sm"
                  />
                  <div className="mt-2 max-h-52 overflow-auto border border-line p-3 text-sm">
                    {formProducts.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={
                            collectionForm.productSlugs.includes(p.slug) ||
                            (!!collectionForm.slug && p.collection === collectionForm.slug)
                          }
                          onChange={(e) => toggleFormProduct(p.slug, e.target.checked)}
                        />
                        <span className="line-clamp-1">{p.name}</span>
                        <span className="ml-auto text-xs text-ink-soft">{p.sku}</span>
                      </label>
                    ))}
                    {!formProducts.length && (
                      <p className="text-ink-soft">No products match your search.</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="submit" className="bg-ink px-5 py-2 text-xs uppercase tracking-widest text-ivory">
                    {collectionForm.slug && collections.some((c) => c.slug === collectionForm.slug)
                      ? "Update collection"
                      : "Add collection"}
                  </button>
                  {collectionForm.slug && (
                    <button
                      type="button"
                      onClick={() => {
                        setCollectionForm(emptyCollection());
                        setCollectionProductQ("");
                      }}
                      className="border border-line px-5 py-2 text-xs uppercase tracking-widest"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>

            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-gold-deep">
                All collections ({collections.length})
              </p>
              {collections.map((c) => {
                const live = collections.find((x) => x.slug === c.slug) ?? c;
                const total = catalog.filter((p) => productInCollection(p, c.slug, collections)).length;
                const expanded = expandedCollectionSlug === c.slug;
                return (
                  <div key={c.slug} className="border border-line bg-paper p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{c.name}</p>
                        <p className="text-sm text-ink-soft">
                          /{c.slug} · {total} product{total === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs uppercase tracking-widest">
                        <button
                          type="button"
                          onClick={() => setExpandedCollectionSlug(expanded ? null : c.slug)}
                        >
                          {expanded ? "Hide products" : "Manage products"}
                        </button>
                        <button type="button" onClick={() => editCollection(c)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCollectionSlug(c.slug);
                            setShowManageCollections(false);
                          }}
                        >
                          View in list
                        </button>
                        <button type="button" onClick={() => removeCollection(c.slug)}>
                          Remove
                        </button>
                      </div>
                    </div>
                    {c.tagline && <p className="mt-2 text-sm text-ink-soft">{c.tagline}</p>}
                    {expanded && (
                      <div className="mt-4 max-h-56 overflow-auto border border-line bg-ivory/40 p-3 text-sm">
                        {catalog.map((p) => (
                          <label key={p.id} className="flex items-center gap-2 py-1.5">
                            <input
                              type="checkbox"
                              checked={live.productSlugs.includes(p.slug) || p.collection === c.slug}
                              onChange={(e) => toggleCollectionProduct(c.slug, p.slug, e.target.checked)}
                            />
                            <span className="line-clamp-1">{p.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {!collections.length && (
                <p className="text-sm text-ink-soft">
                  No collections yet. Use <strong>New collection</strong> to create one, or restore seed data.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside className="h-fit space-y-3 border border-line bg-ivory/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gold-deep">Categories</p>
            <Link href="/admin/categories" className="text-xs underline">
              Manage
            </Link>
          </div>
          <button
            type="button"
            onClick={() => {
              setCategoryId("all");
              setSelected([]);
            }}
            className={`block w-full rounded border px-3 py-2 text-left text-sm transition ${
              categoryId === "all" ? "border-ink bg-paper" : "border-line hover:border-ink"
            }`}
          >
            <span className="font-medium">All products</span>
            <span className="mt-0.5 block text-xs text-ink-soft">{catalog.length} total</span>
          </button>
          {unassignedCount > 0 && (
            <button
              type="button"
              onClick={() => setCategoryId("__unassigned__")}
              className={`block w-full rounded border px-3 py-2 text-left text-sm transition ${
                categoryId === "__unassigned__" ? "border-ink bg-paper" : "border-line hover:border-ink"
              }`}
            >
              <span className="font-medium">Unassigned</span>
              <span className="mt-0.5 block text-xs text-ink-soft">{unassignedCount} need a category</span>
            </button>
          )}
          {categoryStats.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryId(c.id)}
              className={`block w-full rounded border px-3 py-2 text-left text-sm transition ${
                categoryId === c.id ? "border-ink bg-paper" : "border-line hover:border-ink"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.name}</span>
                {!c.enabled && <span className="text-[10px] uppercase text-ink-soft">Hidden</span>}
              </span>
              <span className="mt-0.5 block text-xs text-ink-soft">
                {c.published} live · {c.drafts} draft · {c.total} total
              </span>
            </button>
          ))}
          {!categories.length && (
            <p className="text-sm text-ink-soft">
              No categories yet.{" "}
              <Link href="/admin/categories" className="underline">
                Create one
              </Link>{" "}
              before assigning products.
            </p>
          )}
          {activeCategory && categoryStats.find((c) => c.id === activeCategory.id)?.drafts ? (
            <button
              type="button"
              onClick={() => launchCategory(activeCategory.id)}
              className="mt-2 w-full bg-ink px-3 py-2 text-xs font-semibold uppercase tracking-widest text-ivory"
            >
              Launch drafts in {activeCategory.name}
            </button>
          ) : null}

          <div className="border-t border-line pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gold-deep">Collections</p>
            <button
              type="button"
              onClick={() => setCollectionSlug("all")}
              className={`mt-3 block w-full rounded border px-3 py-2 text-left text-sm transition ${
                collectionSlug === "all" ? "border-ink bg-paper" : "border-line hover:border-ink"
              }`}
            >
              <span className="font-medium">All collections</span>
            </button>
            {collectionStats.map((c) => (
              <button
                key={c.slug}
                type="button"
                onClick={() => setCollectionSlug(c.slug)}
                className={`mt-2 block w-full rounded border px-3 py-2 text-left text-sm transition ${
                  collectionSlug === c.slug ? "border-ink bg-paper" : "border-line hover:border-ink"
                }`}
              >
                <span className="font-medium">{c.name}</span>
                <span className="mt-0.5 block text-xs text-ink-soft">
                  {c.total} product{c.total === 1 ? "" : "s"}
                </span>
              </button>
            ))}
            {!collections.length && (
              <button
                type="button"
                onClick={() => setShowManageCollections(true)}
                className="mt-2 text-sm text-ink-soft underline"
              >
                Create a collection
              </button>
            )}
          </div>
        </aside>

        <div>
          <div className="flex flex-wrap gap-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, SKU or category"
              className="min-w-[200px] flex-1 border border-line bg-transparent px-3 py-2 text-sm"
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="border border-line bg-transparent px-3 py-2 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
            <select
              value={collectionSlug}
              onChange={(e) => setCollectionSlug(e.target.value)}
              className="border border-line bg-transparent px-3 py-2 text-sm"
            >
              <option value="all">All collections</option>
              {collections.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="border border-line bg-transparent px-3 py-2 text-sm"
            >
              <option value="category">Sort: category order</option>
              <option value="name">Sort: name</option>
              <option value="status">Sort: status</option>
              <option value="price">Sort: price</option>
            </select>
            {selected.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-widest">
                <button onClick={() => publishProducts(selected)}>Publish selected</button>
                <button
                  onClick={() => {
                    selected.forEach((id) => {
                      const p = catalog.find((x) => x.id === id);
                      if (p) upsertProduct({ ...p, status: "draft" });
                    });
                    setSelected([]);
                  }}
                >
                  Unpublish
                </button>
                <button
                  onClick={() => {
                    selected.forEach((id) => {
                      const p = catalog.find((x) => x.id === id);
                      if (p) upsertProduct({ ...p, status: "archived" });
                    });
                    setSelected([]);
                  }}
                >
                  Archive
                </button>
                {collections.length > 0 && (
                  <>
                    <select
                      value={bulkCollection}
                      onChange={(e) => setBulkCollection(e.target.value)}
                      className="border border-line bg-transparent px-2 py-1 text-xs normal-case"
                    >
                      <option value="">Collection…</option>
                      {collections.map((c) => (
                        <option key={c.slug} value={c.slug}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!bulkCollection}
                      onClick={() => assignSelectedToCollection("add")}
                    >
                      Add to collection
                    </button>
                    <button
                      type="button"
                      disabled={!bulkCollection}
                      onClick={() => assignSelectedToCollection("remove")}
                    >
                      Remove from collection
                    </button>
                  </>
                )}
                {!collections.length && (
                  <button type="button" onClick={() => setShowManageCollections(true)}>
                    Create collection
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-soft">
              Showing <strong className="text-ink">{list.length}</strong> of{" "}
              <strong className="text-ink">{catalog.length}</strong> products
              {collections.length > 0 && (
                <>
                  {" "}
                  · <strong className="text-ink">{collections.length}</strong> collection
                  {collections.length === 1 ? "" : "s"}
                </>
              )}
            </p>
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="text-xs uppercase tracking-widest underline">
                Clear filters
              </button>
            )}
          </div>

          {(activeCategory || (activeCollection && collectionSlug !== "all") || categoryId === "__unassigned__") && (
            <p className="mt-2 text-sm text-ink-soft">
              Filtered
              {categoryId === "__unassigned__" && (
                <>
                  {" "}
                  to <strong className="text-ink">unassigned category</strong>
                </>
              )}
              {activeCategory && categoryId !== "__unassigned__" && (
                <>
                  {" "}
                  to category <strong className="text-ink">{activeCategory.name}</strong>
                  {activeCategory.enabled ? "" : " (hidden on shop)"}
                </>
              )}
              {activeCollection && collectionSlug !== "all" && (
                <>
                  {activeCategory ? " ·" : ""} in collection{" "}
                  <strong className="text-ink">{activeCollection.name}</strong>
                </>
              )}
            </p>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-widest text-gold-deep">
                <tr>
                  <th className="py-3">
                    <input
                      type="checkbox"
                      checked={list.length > 0 && list.every((p) => selected.includes(p.id))}
                      onChange={(e) => setSelected(e.target.checked ? list.map((p) => p.id) : [])}
                    />
                  </th>
                  <th>SKU</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Collections</th>
                  <th>Status</th>
                  <th>Stock</th>
                  <th>From</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const cat = categories.find((c) => c.id === productCategoryId(p, categories));
                  const st = p.status ?? "published";
                  const pCollections = productCollectionSlugs(p, collections)
                    .map((slug) => collections.find((c) => c.slug === slug))
                    .filter(Boolean);
                  return (
                    <tr key={p.id} className="border-t border-line">
                      <td className="py-3">
                        <input
                          type="checkbox"
                          checked={selected.includes(p.id)}
                          onChange={(e) =>
                            setSelected(e.target.checked ? [...selected, p.id] : selected.filter((id) => id !== p.id))
                          }
                        />
                      </td>
                      <td>{p.sku}</td>
                      <td>{p.name}</td>
                      <td>
                        {cat?.name ?? p.category}
                        {!cat && <span className="ml-1 text-xs text-red-800">(unassigned)</span>}
                      </td>
                      <td className="max-w-[180px]">
                        {pCollections.length ? (
                          <div className="flex flex-wrap gap-1">
                            {pCollections.map((c) => (
                              <button
                                key={c!.slug}
                                type="button"
                                onClick={() => {
                                  setCollectionSlug(c!.slug);
                                  setShowManageCollections(false);
                                }}
                                className="rounded border border-line px-1.5 py-0.5 text-[11px] normal-case tracking-normal hover:border-ink"
                                title={p.collection === c!.slug ? "Primary collection" : "In collection"}
                              >
                                {c!.name}
                                {p.collection === c!.slug ? " ★" : ""}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-ink-soft">None</span>
                        )}
                      </td>
                      <td className="capitalize">{st}</td>
                      <td>{variantStock(p)}</td>
                      <td>{formatINR(Math.min(...p.variants.map((v) => v.salePrice ?? v.price)))}</td>
                      <td className="space-x-3 text-xs uppercase tracking-widest">
                        <Link href={`/admin/products/${p.id}`}>Edit</Link>
                        {st === "draft" && (
                          <button type="button" onClick={() => publishProducts([p.id])}>
                            Launch
                          </button>
                        )}
                        <button onClick={() => deleteProduct(p.id)}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
                {!list.length && (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-ink-soft">
                      No products match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
