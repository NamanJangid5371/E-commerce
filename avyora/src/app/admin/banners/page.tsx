"use client";

import { BannerEditor, emptyBanner, pickHeroBanner, pickPromoBanners } from "@/components/admin/banner-editor";
import type { Banner } from "@/data/admin-ops";
import { useShopStore } from "@/store/shop-store";
import Link from "next/link";
import { useMemo, useState } from "react";

export default function BannersAdmin() {
  const ops = useShopStore((s) => s.ops);
  const setOps = useShopStore((s) => s.setOps);
  const sorted = useMemo(() => [...ops.banners].sort((a, b) => a.order - b.order), [ops.banners]);
  const [form, setForm] = useState<Banner>(() => emptyBanner(sorted.length + 1));
  const editingExisting = ops.banners.some((b) => b.id === form.id);

  function saveBanner(banner: Banner) {
    const exists = ops.banners.some((b) => b.id === banner.id);
    setOps({
      ...ops,
      banners: exists ? ops.banners.map((b) => (b.id === banner.id ? banner : b)) : [...ops.banners, banner],
    });
    if (!exists) setForm(emptyBanner(sorted.length + 2));
  }

  function removeBanner(id: string) {
    setOps({ ...ops, banners: ops.banners.filter((b) => b.id !== id) });
    if (form.id === id) setForm(emptyBanner(sorted.length));
  }

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Banners</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Edit homepage hero, promo blocks, and strips. Promo blocks appear in the homepage Offer section.
          Changes sync to the live storefront automatically.
        </p>

        <div className="mt-6 border border-line bg-paper/40 p-4">
          <p className="text-sm font-medium">{editingExisting ? "Edit banner" : "Create banner"}</p>
          <p className="mt-1 text-xs text-ink-soft">
            {editingExisting ? `Editing ${form.title || form.id}` : "Add a new hero, promo, or strip banner."}
          </p>
          <BannerEditor
            banner={form}
            onChange={setForm}
            onSave={saveBanner}
            onCancel={editingExisting ? () => setForm(emptyBanner(sorted.length + 1)) : undefined}
            saveLabel={editingExisting ? "Update banner" : "Create banner"}
            compact
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">All banners</h2>
          <button type="button" className="text-xs uppercase tracking-widest" onClick={() => setForm(emptyBanner(sorted.length + 1))}>
            New
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {sorted.map((b) => (
            <div key={b.id} className="border border-line p-3">
              <div className="relative mb-3 aspect-[2/1] overflow-hidden">
                <img src={b.image} alt="" className="h-full w-full object-cover" />
              </div>
              <p className="font-medium">{b.title}</p>
              <p className="mt-1 text-xs text-ink-soft">
                {b.placement} · order {b.order} · {b.enabled ? "live" : "hidden"} · {b.device}
              </p>
              {b.placement === "hero" && pickHeroBanner(ops.banners)?.id === b.id ? (
                <p className="mt-1 text-[10px] tracking-widest uppercase text-gold-deep">Active homepage hero</p>
              ) : null}
              {b.placement === "promo" && pickPromoBanners(ops.banners).some((p) => p.id === b.id) ? (
                <p className="mt-1 text-[10px] tracking-widest uppercase text-gold-deep">Live on homepage</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-3 text-xs uppercase tracking-widest">
                <button type="button" onClick={() => setForm(b)}>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setOps({ ...ops, banners: ops.banners.map((x) => (x.id === b.id ? { ...x, enabled: !x.enabled } : x)) })}
                >
                  {b.enabled ? "Hide" : "Show"}
                </button>
                <button type="button" onClick={() => removeBanner(b.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          {sorted.length === 0 ? <p className="text-sm text-ink-soft">No banners yet.</p> : null}
        </div>
        <Link href="/" target="_blank" className="mt-6 inline-block text-xs tracking-widest uppercase underline">
          Preview storefront
        </Link>
      </div>
    </div>
  );
}
