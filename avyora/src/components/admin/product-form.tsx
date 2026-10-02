"use client";

import type { Metal, Product, ProductStatus, ProductVariant } from "@/data/types";
import { STOREFRONT_ORIGIN, putCommerce } from "@/lib/host";
import { MEDIA_LIBRARY, slugify } from "@/lib/media";
import { ClearableNumberInput } from "@/components/admin/clearable-number-input";
import { ProductImage } from "@/components/product-image";
import { useShopStore } from "@/store/shop-store";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useRef, useState } from "react";

const careDefault =
  "Wipe with a soft lint-free cloth after wear. Store separately in the Avyora pouch. Avoid perfume, chlorinated water and abrasive cleaners.";
const returnDefault =
  "15-day exchange on unworn pieces with original hallmarks, tags and certificate.";

export function emptyProduct(): Product {
  const id = `p-${Date.now()}`;
  return {
    id,
    sku: "AV-NEW-001",
    slug: "new-piece",
    name: "",
    brand: "Avyora",
    category: "Rings",
    collection: "atelier",
    tags: [],
    description: "",
    story: "",
    metal: "Gold",
    purity: "18KT",
    colour: "Yellow",
    weight: "3 g",
    dimensions: "",
    makingCharge: 0,
    taxNote: "Inclusive of making charges. GST extra as applicable at checkout.",
    images: ["/products/ring-1.jpg", "/products/ring-2.jpg", "/products/ring-5.jpg", "/products/ring-6.jpg"],
    spinEnabled: true,
    certificateNumber: "",
    certifiedBy: "BIS Hallmark",
    warranty: "Lifetime manufacturing warranty",
    care: careDefault,
    returnPolicy: returnDefault,
    seoTitle: "",
    seoDescription: "",
    rating: 5,
    reviewCount: 0,
    reviews: [],
    status: "draft",
    variants: [
      {
        sku: `AV-NEW-${Date.now().toString().slice(-4)}`,
        metal: "Gold",
        purity: "18KT",
        colour: "Yellow",
        stock: 4,
        price: 25000,
      },
    ],
  };
}

export function ProductForm({ initial, mode }: { initial: Product; mode: "create" | "edit" }) {
  const upsert = useShopStore((s) => s.upsertProduct);
  const syncProductCollectionMembership = useShopStore((s) => s.syncProductCollectionMembership);
  const upsertCoupon = useShopStore((s) => s.upsertCoupon);
  const coupons = useShopStore((s) => s.coupons);
  const collections = useShopStore((s) => s.collections);
  const extraMedia = useShopStore((s) => s.mediaUrls);
  const addMediaUrl = useShopStore((s) => s.addMediaUrl);
  const ops = useShopStore((s) => s.ops);
  const router = useRouter();
  const [product, setProduct] = useState<Product>(initial);
  const [imageUrl, setImageUrl] = useState("");
  const [updatingPhoto, setUpdatingPhoto] = useState(false);
  const [photoUpdateIndex, setPhotoUpdateIndex] = useState(0);
  const [photoUpdated, setPhotoUpdated] = useState(false);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [linkedCoupons, setLinkedCoupons] = useState<string[]>(() =>
    coupons.filter((c) => c.productSlugs?.includes(initial.slug)).map((c) => c.code),
  );
  const [memberCollections, setMemberCollections] = useState<string[]>(() => {
    const fromLists = collections.filter((c) => c.productSlugs.includes(initial.slug)).map((c) => c.slug);
    if (fromLists.length) return fromLists;
    if (initial.collection) return [initial.collection];
    return [];
  });
  const media = useMemo(() => [...new Set([...product.images, ...extraMedia, ...MEDIA_LIBRARY])], [extraMedia, product.images]);

  function patch(partial: Partial<Product>) {
    setProduct((p) => ({ ...p, ...partial }));
  }

  function updateVariant(i: number, partial: Partial<ProductVariant>) {
    setProduct((p) => ({
      ...p,
      variants: p.variants.map((v, idx) => (idx === i ? { ...v, ...partial } : v)),
    }));
  }

  function moveImage(index: number, direction: -1 | 1) {
    const next = [...product.images];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    patch({ images: next });
  }

  function addImage(src: string) {
    const trimmed = src.trim();
    if (!trimmed || product.images.includes(trimmed)) return;
    addMediaUrl(trimmed);
    patch({ images: [...product.images, trimmed] });
    setImageUrl("");
  }

  async function applyWebsitePhoto(imageSrc: string) {
    const trimmed = imageSrc.trim();
    if (!trimmed) return;

    setUpdatingPhoto(true);
    setPhotoUpdated(false);
    try {
      const current = useShopStore.getState().catalog.find((p) => p.id === initial.id) ?? product;
      addMediaUrl(trimmed);
      const images = [...current.images];
      const slot = Math.min(photoUpdateIndex, Math.max(images.length - 1, 0));
      if (!images.length) {
        images.push(trimmed);
      } else {
        images[slot] = trimmed;
      }

      const next: Product = { ...current, id: initial.id, images };
      setProduct(next);
      upsert(next);

      const state = useShopStore.getState();
      const catalog = state.catalog.map((p) => (p.id === next.id ? next : p));

      await putCommerce({
        catalog,
        collections: state.collections,
        coupons: state.coupons,
        customers: state.customers,
        orders: state.orders,
        campaigns: state.campaigns,
        mediaUrls: state.mediaUrls.includes(trimmed) ? state.mediaUrls : [trimmed, ...state.mediaUrls],
        audit: state.audit,
        appointments: state.appointments,
        ops: state.ops,
      });

      setPhotoUpdated(true);
      setShowPhotoPicker(false);
    } catch {
      alert("Could not update this product's photo on the Avyora website. Try again.");
    } finally {
      setUpdatingPhoto(false);
    }
  }

  async function updateProductWebsitePhoto(file: File | null) {
    if (!file) return;
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        credentials: "include",
        body,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Update failed");
      await applyWebsitePhoto(data.url);
    } catch {
      alert("Could not upload from your computer. Pick a photo from the library instead.");
    }
  }

  function syncCouponLinks(slug: string) {
    coupons.forEach((c) => {
      const shouldLink = linkedCoupons.includes(c.code);
      const slugs = c.productSlugs ?? [];
      const has = slugs.includes(slug);
      if (shouldLink && !has) upsertCoupon({ ...c, productSlugs: [...slugs, slug] });
      if (!shouldLink && has) upsertCoupon({ ...c, productSlugs: slugs.filter((s) => s !== slug) });
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const slug = product.slug || slugify(product.name);
    const next: Product = {
      ...product,
      slug,
      seoTitle: product.seoTitle || `${product.name} | Avyora`,
      seoDescription: product.seoDescription || product.description.slice(0, 140),
      images: product.images.length ? product.images.slice(0, 24) : [MEDIA_LIBRARY[0]],
      spinEnabled: product.spinEnabled !== false,
    };
    upsert(next);
    syncCouponLinks(slug);
    const primary = next.collection;
    const slugs = primary && !memberCollections.includes(primary) ? [...memberCollections, primary] : memberCollections;
    syncProductCollectionMembership(slug, slugs, primary);
    router.push("/admin/products");
  }

  return (
    <form onSubmit={onSubmit} className="max-w-4xl space-y-10">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm">
          Name
          <input
            required
            value={product.name}
            onChange={(e) => patch({ name: e.target.value, slug: mode === "create" ? slugify(e.target.value) : product.slug })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          />
        </label>
        <label className="text-sm">
          Slug
          <input
            required
            value={product.slug}
            onChange={(e) => patch({ slug: slugify(e.target.value) })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          />
        </label>
        <label className="text-sm">
          SKU
          <input
            required
            value={product.sku}
            onChange={(e) => patch({ sku: e.target.value })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          />
        </label>
        <label className="text-sm">
          Status
          <select
            value={product.status ?? "published"}
            onChange={(e) => patch({ status: e.target.value as ProductStatus })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="text-sm">
          Category
          <select
            value={product.categoryId ?? ops?.categories.find((c) => c.name === product.category)?.id ?? ""}
            onChange={(e) => {
              const cat = ops?.categories.find((c) => c.id === e.target.value);
              if (cat) patch({ category: cat.name, categoryId: cat.id });
            }}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
            required
          >
            <option value="" disabled>
              Select category
            </option>
            {[...(ops?.categories ?? [])]
              .sort((a, b) => a.order - b.order)
              .map((c) => (
                <option key={c.id} value={c.id} disabled={!c.enabled}>
                  {c.name}
                  {!c.enabled ? " (hidden)" : ""}
                </option>
              ))}
          </select>
          <span className="mt-1 block text-xs text-ink-soft">
            Categories are managed in{" "}
            <a href="/admin/categories" className="underline">
              Admin → Categories
            </a>
            . Only enabled categories appear on the shop.
          </span>
        </label>
        <label className="text-sm">
          Primary collection
          <select
            value={product.collection}
            onChange={(e) => {
              const slug = e.target.value;
              patch({ collection: slug });
              setMemberCollections((prev) => (prev.includes(slug) ? prev : [...prev, slug]));
            }}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          >
            {collections.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="text-sm md:col-span-2">
          <legend className="mb-2">Also in collections</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2 border border-line p-3">
            {collections.map((c) => (
              <label key={c.slug} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={memberCollections.includes(c.slug)}
                  onChange={(e) =>
                    setMemberCollections((prev) =>
                      e.target.checked ? [...prev, c.slug] : prev.filter((s) => s !== c.slug),
                    )
                  }
                />
                {c.name}
              </label>
            ))}
            {!collections.length && (
              <span className="text-ink-soft">
                No collections yet. Use <strong>Manage collections</strong> above to create one.
              </span>
            )}
          </div>
        </fieldset>
        <label className="text-sm">
          Metal
          <select
            value={product.metal}
            onChange={(e) => patch({ metal: e.target.value as Metal })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          >
            {["Gold", "Silver", "Platinum"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Tags (comma)
          <input
            value={product.tags.join(", ")}
            onChange={(e) => patch({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          />
        </label>
      </div>

      <label className="block text-sm">
        Short description
        <input
          value={product.shortDescription ?? ""}
          onChange={(e) => patch({ shortDescription: e.target.value })}
          className="mt-1 w-full border border-line bg-transparent px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        Description
        <textarea
          value={product.description}
          onChange={(e) => patch({ description: e.target.value })}
          className="mt-1 min-h-24 w-full border border-line bg-transparent px-3 py-2"
        />
      </label>

      <section className="space-y-3">
        <div className="grid grid-cols-2 gap-6 border-b border-line pb-2">
          <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-ink">Regular price (₹)</p>
          <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-ink">Sale price (₹)</p>
        </div>
        <div className="divide-y divide-line">
          {product.variants.map((v, i) => (
            <div key={i} className="grid grid-cols-2 gap-6 py-3">
              <input
                type="number"
                min={0}
                value={v.price}
                onChange={(e) => updateVariant(i, { price: Number(e.target.value) })}
                className="w-full rounded-full border border-line bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-ink"
                aria-label={`Regular price variant ${i + 1}`}
              />
              <input
                type="number"
                min={0}
                value={v.salePrice ?? ""}
                onChange={(e) =>
                  updateVariant(i, { salePrice: e.target.value ? Number(e.target.value) : undefined })
                }
                className="w-full rounded-full border border-line bg-white px-4 py-2.5 text-sm text-ink outline-none focus:border-ink"
                aria-label={`Sale price variant ${i + 1}`}
                placeholder="0"
              />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4 border border-line p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">Variants</h2>
            <p className="mt-1 text-sm text-ink-soft">SKU, size, and stock for each price row above.</p>
          </div>
          <button
            type="button"
            className="text-xs uppercase tracking-widest"
            onClick={() =>
              setProduct((p) => ({
                ...p,
                variants: [
                  ...p.variants,
                  {
                    sku: `${p.sku}-${p.variants.length + 1}`,
                    metal: p.metal,
                    purity: p.purity,
                    colour: p.colour,
                    stock: 1,
                    price: p.variants[0]?.price ?? 10000,
                  },
                ],
              }))
            }
          >
            Add variant
          </button>
        </div>
        <div className="space-y-3">
          {product.variants.map((v, i) => (
            <div key={i} className="grid gap-3 border-t border-line pt-3 md:grid-cols-[1.2fr_0.6fr_0.6fr_auto]">
              <label className="text-sm">
                SKU
                <input
                  value={v.sku}
                  onChange={(e) => updateVariant(i, { sku: e.target.value })}
                  className="mt-1 w-full border border-line bg-transparent px-3 py-2"
                />
              </label>
              <label className="text-sm">
                Size
                <input
                  value={v.size ?? ""}
                  onChange={(e) => updateVariant(i, { size: e.target.value || undefined })}
                  className="mt-1 w-full border border-line bg-transparent px-3 py-2"
                  placeholder="—"
                />
              </label>
              <label className="text-sm">
                Stock
                <ClearableNumberInput
                  value={v.stock}
                  min={0}
                  aria-label={`Stock for ${v.sku || `variant ${i + 1}`}`}
                  onCommit={(stock) => updateVariant(i, { stock })}
                  className="mt-1 w-full border border-line bg-transparent px-3 py-2"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  className="pb-2 text-xs uppercase tracking-widest"
                  onClick={() => setProduct((p) => ({ ...p, variants: p.variants.filter((_, idx) => idx !== i) }))}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <label className="block max-w-xs text-sm">
          Making charge (₹)
          <input
            type="number"
            min={0}
            value={product.makingCharge}
            onChange={(e) => patch({ makingCharge: Number(e.target.value) })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          />
        </label>
      </section>

      <section className="space-y-4 border border-line p-5">
        <div>
          <h2 className="text-lg font-medium">Website photo</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Update the photo shown for <span className="font-medium text-ink">{product.name || "this product"}</span> on the Avyora website.
            The main photo appears on shop, home, and the product page.
          </p>
        </div>

        {photoUpdated && (
          <p className="border border-line bg-ivory px-4 py-3 text-sm">
            Photo updated for this product on the website.{" "}
            {product.slug ? (
              <a
                href={`${STOREFRONT_ORIGIN}/product/${product.slug}`}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                View on Avyora site
              </a>
            ) : (
              "Save the product slug to preview on the site."
            )}
          </p>
        )}

        {product.images.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {product.images.map((src, i) => (
              <div key={`${src}-${i}`} className="relative w-32">
                <div className={`relative aspect-square overflow-hidden border ${i === 0 ? "border-ink ring-1 ring-ink" : photoUpdateIndex === i ? "border-gold-deep ring-1 ring-gold-deep" : "border-line"}`}>
                  <ProductImage src={src} alt="" fill />
                </div>
                <p className="mt-1 text-center text-[10px] uppercase tracking-widest text-ink-soft">
                  {i === 0 ? "Main (website)" : `#${i + 1}`}
                </p>
                <div className="mt-1 flex flex-wrap justify-center gap-1 text-[10px] uppercase tracking-widest">
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoUpdateIndex(i);
                      setPhotoUpdated(false);
                    }}
                    className={photoUpdateIndex === i ? "text-ink underline" : ""}
                  >
                    Select
                  </button>
                  <button type="button" onClick={() => moveImage(i, -1)} disabled={i === 0}>
                    ←
                  </button>
                  <button type="button" onClick={() => patch({ images: product.images.filter((_, idx) => idx !== i) })}>
                    Remove
                  </button>
                  <button type="button" onClick={() => moveImage(i, 1)} disabled={i === product.images.length - 1}>
                    →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={updatingPhoto}
            onClick={() => {
              setShowPhotoPicker((open) => !open);
              setPhotoUpdated(false);
            }}
            className="border border-ink bg-ink px-5 py-3 text-xs uppercase tracking-widest text-ivory disabled:opacity-60"
          >
            {updatingPhoto ? "Updating website photo…" : showPhotoPicker ? "Close photo picker" : "Update photo"}
          </button>
          <button
            type="button"
            disabled={updatingPhoto}
            onClick={() => fileInputRef.current?.click()}
            className="border border-line px-4 py-3 text-xs uppercase tracking-widest"
          >
            Browse computer
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
            className="hidden"
            onChange={(e) => {
              void updateProductWebsitePhoto(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          <span className="text-sm text-ink-soft">
            Update photo opens the library here. Browse computer opens File Explorer only if you need a new file from your PC.
          </span>
        </div>

        {showPhotoPicker && (
          <div className="border border-gold-deep bg-ivory p-4">
            <p className="text-sm font-medium">Choose a photo for this product</p>
            <p className="mt-1 text-sm text-ink-soft">
              Click any image below to replace{" "}
              {photoUpdateIndex === 0 ? "the main website photo" : `photo #${photoUpdateIndex + 1}`} for{" "}
              <span className="font-medium text-ink">{product.name || "this product"}</span>.
            </p>
            <div className="mt-4 grid grid-cols-4 gap-3 md:grid-cols-8">
              {media.map((src) => (
                <button
                  type="button"
                  key={src}
                  disabled={updatingPhoto}
                  onClick={() => void applyWebsitePhoto(src)}
                  className={`relative aspect-square overflow-hidden border transition hover:opacity-100 ${
                    product.images[photoUpdateIndex] === src ? "border-ink ring-2 ring-ink" : "border-line opacity-80 hover:border-ink"
                  }`}
                >
                  <ProductImage src={src} alt="" fill />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-line pt-4">
          <p className="text-sm font-medium">Add extra gallery images</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="/products/ring-1.jpg or https://…"
              className="min-w-64 flex-1 border border-line bg-transparent px-3 py-2 text-sm"
            />
            <button type="button" onClick={() => addImage(imageUrl)} className="border border-line px-4 py-2 text-xs uppercase tracking-widest">
              Add URL
            </button>
          </div>
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={product.spinEnabled !== false}
              onChange={(e) => patch({ spinEnabled: e.target.checked })}
            />
            <span>
              <span className="font-medium">360° viewer</span>
              <span className="mt-0.5 block text-ink-soft">
                Shoppers drag or swipe gallery photos to rotate the piece. Order images clockwise around the jewel — up to 24 frames.
              </span>
            </span>
          </label>
        </div>

        <label className="block text-sm">
          Lifestyle image (optional)
          <select
            value={product.lifestyleImage ?? ""}
            onChange={(e) => patch({ lifestyleImage: e.target.value || undefined })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          >
            <option value="">None</option>
            {media.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </select>
        </label>

        <div>
          <p className="text-sm font-medium">All media (add to gallery)</p>
          <div className="mt-3 grid grid-cols-4 gap-3 md:grid-cols-8">
            {media.map((src) => {
              const on = product.images.includes(src);
              return (
                <button
                  type="button"
                  key={src}
                  onClick={() =>
                    patch({
                      images: on ? product.images.filter((i) => i !== src) : [...product.images, src],
                    })
                  }
                  className={`relative aspect-square overflow-hidden border ${on ? "border-ink ring-1 ring-ink" : "border-line opacity-60"}`}
                >
                  <ProductImage src={src} alt="" fill />
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!product.featured} onChange={(e) => patch({ featured: e.target.checked })} />
          Featured
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!product.bestSeller} onChange={(e) => patch({ bestSeller: e.target.checked })} />
          Bestseller
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!product.newArrival} onChange={(e) => patch({ newArrival: e.target.checked })} />
          New arrival
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={product.searchable !== false} onChange={(e) => patch({ searchable: e.target.checked })} />
          Searchable
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm">
          Min stock alert
          <ClearableNumberInput
            value={product.minStock ?? 3}
            min={0}
            aria-label="Minimum stock alert"
            onCommit={(minStock) => patch({ minStock })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          />
        </label>
        <label className="text-sm">
          Related slugs (comma)
          <input
            value={(product.relatedSlugs ?? []).join(", ")}
            onChange={(e) => patch({ relatedSlugs: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          />
        </label>
        <label className="text-sm md:col-span-2">
          Frequently bought together (slugs)
          <input
            value={(product.togetherSlugs ?? []).join(", ")}
            onChange={(e) => patch({ togetherSlugs: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm">
          Certificate
          <input
            value={product.certificateNumber}
            onChange={(e) => patch({ certificateNumber: e.target.value })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          />
        </label>
        <label className="text-sm">
          Weight
          <input
            value={product.weight}
            onChange={(e) => patch({ weight: e.target.value })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          />
        </label>
      </div>

      <button className="bg-ink px-6 py-3 text-[11px] tracking-[0.2em] uppercase text-ivory">
        {mode === "create" ? "Create product" : "Save product"}
      </button>
    </form>
  );
}
