"use client";

import { BannerEditor, emptyBanner, pickHeroBanner } from "@/components/admin/banner-editor";
import { ProductImage } from "@/components/product-image";
import type { Banner, HomepageSection } from "@/data/admin-ops";
import type { Product } from "@/data/types";
import {
  HOMEPAGE_PRODUCT_SECTIONS,
  HOMEPAGE_SECTION_LABELS,
  HOMEPAGE_SECTION_LIMITS,
  type HomepageProductSectionId,
} from "@/lib/homepage-products";
import { isPublished, useShopStore } from "@/store/shop-store";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function sectionProductIds(sections: HomepageSection[], sectionId: HomepageProductSectionId) {
  return sections.find((s) => s.id === sectionId)?.productIds ?? [];
}

function updateSectionProductIds(
  sections: HomepageSection[],
  sectionId: HomepageProductSectionId,
  productIds: string[],
) {
  return sections.map((s) => (s.id === sectionId ? { ...s, productIds } : s));
}

function HomepageProductPicker({
  sectionId,
  sections,
  catalog,
  onChange,
}: {
  sectionId: HomepageProductSectionId;
  sections: HomepageSection[];
  catalog: Product[];
  onChange: (productIds: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const limit = HOMEPAGE_SECTION_LIMITS[sectionId];
  const selectedIds = sectionProductIds(sections, sectionId);
  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);
  const selected = selectedIds.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));

  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog
      .filter((p) => !selectedIds.includes(p.id))
      .filter((p) => {
        if (!q) return true;
        return `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(q);
      })
      .slice(0, 12);
  }, [catalog, query, selectedIds]);

  function add(id: string) {
    if (selectedIds.length >= limit || selectedIds.includes(id)) return;
    onChange([...selectedIds, id]);
  }

  function remove(id: string) {
    onChange(selectedIds.filter((x) => x !== id));
  }

  function reorder(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= selectedIds.length || to >= selectedIds.length) return;
    const next = [...selectedIds];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-sm font-medium">{HOMEPAGE_SECTION_LABELS[sectionId]}</p>
      <p className="mt-1 text-xs text-ink-soft">
        Pick up to {limit} products. Drag rows to set storefront order.
        {selectedIds.length === 0 ? " Leave empty to use product flags automatically." : ""}
      </p>

      {selected.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {selected.map((p, index) => (
            <li
              key={p.id}
              draggable
              onDragStart={(e) => {
                setDragIndex(index);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(index));
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overIndex !== index) setOverIndex(index);
              }}
              onDragLeave={() => {
                if (overIndex === index) setOverIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragIndex ?? Number(e.dataTransfer.getData("text/plain"));
                reorder(from, index);
                setDragIndex(null);
                setOverIndex(null);
              }}
              className={`flex cursor-grab items-center gap-3 border bg-ivory/50 p-2 active:cursor-grabbing ${
                overIndex === index && dragIndex !== null && dragIndex !== index
                  ? "border-ink"
                  : "border-line"
              } ${dragIndex === index ? "opacity-60" : ""}`}
            >
              <span
                className="flex h-10 w-5 shrink-0 flex-col items-center justify-center gap-0.5 text-ink-soft"
                aria-hidden
                title="Drag to reorder"
              >
                <span className="block h-0.5 w-3 bg-current" />
                <span className="block h-0.5 w-3 bg-current" />
                <span className="block h-0.5 w-3 bg-current" />
              </span>
              <div className="relative h-12 w-12 shrink-0 overflow-hidden">
                <ProductImage src={p.images[0]} alt={p.name} fill sizes="48px" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="text-xs text-ink-soft">
                  {index === 0 && sectionId === "bestsellers" ? "Main feature · " : ""}
                  {p.sku}
                  {!isPublished(p) ? " · Unpublished" : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(p.id)}
                onMouseDown={(e) => e.stopPropagation()}
                className="shrink-0 text-[10px] uppercase tracking-widest text-ink-soft transition hover:text-ink"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-ink-soft">No manual picks — using bestseller / new arrival / featured flags.</p>
      )}

      {selectedIds.length < limit && (
        <div className="mt-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products to add"
            className="w-full border border-line bg-transparent px-3 py-2 text-sm"
          />
          <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto">
            {available.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => add(p.id)}
                  className="flex w-full items-center gap-3 border border-line/70 bg-paper/40 px-2 py-2 text-left hover:border-ink/30"
                >
                  <div className="relative h-10 w-10 shrink-0 overflow-hidden">
                    <ProductImage src={p.images[0]} alt={p.name} fill sizes="40px" />
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                  <span className="text-[10px] tracking-widest uppercase text-ink-soft">Add</span>
                </button>
              </li>
            ))}
            {available.length === 0 && (
              <li className="px-2 py-3 text-xs text-ink-soft">No matching products.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function HeroBannerEditor({ banners, onSave }: { banners: Banner[]; onSave: (banner: Banner) => void }) {
  const hero = pickHeroBanner(banners);
  const [form, setForm] = useState<Banner>(() => hero ?? emptyBanner(1));

  useEffect(() => {
    setForm(hero ?? emptyBanner(1));
  }, [hero, banners]);

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Homepage hero banner</p>
        <Link href="/admin/banners" className="text-[10px] tracking-widest uppercase underline">
          All banners
        </Link>
      </div>
      <BannerEditor banner={form} onChange={setForm} onSave={onSave} saveLabel="Save hero banner" compact />
    </div>
  );
}

export default function HomepageAdmin() {
  const ops = useShopStore((s) => s.ops);
  const setOps = useShopStore((s) => s.setOps);
  const catalog = useShopStore((s) => s.catalog);
  const sections = [...ops.homepageSections].sort((a, b) => a.order - b.order);

  function move(id: string, dir: -1 | 1) {
    const i = sections.findIndex((s) => s.id === id);
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const copy = [...sections];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    setOps({ ...ops, homepageSections: copy.map((s, idx) => ({ ...s, order: idx + 1 })) });
  }

  function setSectionProducts(sectionId: HomepageProductSectionId, productIds: string[]) {
    setOps({
      ...ops,
      homepageSections: updateSectionProductIds(ops.homepageSections, sectionId, productIds),
    });
  }

  function clearSectionProducts(sectionId: HomepageProductSectionId) {
    setSectionProducts(sectionId, []);
  }

  function saveBanner(banner: Banner) {
    const exists = ops.banners.some((b) => b.id === banner.id);
    setOps({
      ...ops,
      banners: exists ? ops.banners.map((b) => (b.id === banner.id ? banner : b)) : [...ops.banners, banner],
    });
  }

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Homepage</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Enable sections, edit the hero banner, and choose homepage products for Signature pieces, New arrivals, and
        Curated selection.
      </p>

      <div className="mt-8 space-y-3">
        {sections.map((s) => {
          const isProductSection = HOMEPAGE_PRODUCT_SECTIONS.includes(s.id as HomepageProductSectionId);

          return (
            <div key={s.id} className="border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{s.title}</p>
                  <p className="text-sm text-ink-soft">
                    Order {s.order} · {s.enabled ? "visible" : "hidden"}
                    {isProductSection
                      ? ` · ${sectionProductIds(sections, s.id as HomepageProductSectionId).length} products picked`
                      : ""}
                  </p>
                </div>
                <div className="space-x-3 text-xs uppercase tracking-widest">
                  <button type="button" onClick={() => move(s.id, -1)}>
                    Up
                  </button>
                  <button type="button" onClick={() => move(s.id, 1)}>
                    Down
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setOps({
                        ...ops,
                        homepageSections: ops.homepageSections.map((x) =>
                          x.id === s.id ? { ...x, enabled: !x.enabled } : x,
                        ),
                      })
                    }
                  >
                    {s.enabled ? "Hide" : "Show"}
                  </button>
                  {isProductSection && sectionProductIds(sections, s.id as HomepageProductSectionId).length > 0 ? (
                    <button type="button" onClick={() => clearSectionProducts(s.id as HomepageProductSectionId)}>
                      Reset
                    </button>
                  ) : null}
                </div>
              </div>

              {s.id === "hero" ? <HeroBannerEditor banners={ops.banners} onSave={saveBanner} /> : null}

              {isProductSection ? (
                <HomepageProductPicker
                  sectionId={s.id as HomepageProductSectionId}
                  sections={sections}
                  catalog={catalog}
                  onChange={(productIds) => setSectionProducts(s.id as HomepageProductSectionId, productIds)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
