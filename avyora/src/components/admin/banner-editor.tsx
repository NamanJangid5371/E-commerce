"use client";

import { ProductImage } from "@/components/product-image";
import type { Banner } from "@/data/admin-ops";
import { MEDIA_LIBRARY } from "@/lib/media";
import { cn } from "@/lib/cn";
import { useShopStore } from "@/store/shop-store";
import { FormEvent, useMemo, useState } from "react";

export function emptyBanner(order = 1): Banner {
  return {
    id: `ban-${Date.now()}`,
    title: "",
    description: "",
    image: MEDIA_LIBRARY[6],
    href: "/shop",
    cta: "Shop the collection",
    placement: "hero",
    device: "all",
    enabled: true,
    order,
  };
}

type BannerEditorProps = {
  banner: Banner;
  onChange: (banner: Banner) => void;
  onSave: (banner: Banner) => void;
  onCancel?: () => void;
  saveLabel?: string;
  compact?: boolean;
};

export function BannerEditor({
  banner,
  onChange,
  onSave,
  onCancel,
  saveLabel = "Save banner",
  compact = false,
}: BannerEditorProps) {
  const mediaUrls = useShopStore((s) => s.mediaUrls);
  const [saved, setSaved] = useState(false);

  const images = useMemo(() => {
    const extra = mediaUrls ?? [];
    return [...new Set([...MEDIA_LIBRARY, ...extra, banner.image].filter(Boolean))];
  }, [mediaUrls, banner.image]);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSave(banner);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  return (
    <form onSubmit={submit} className={cn("space-y-4", compact && "mt-4 border-t border-line pt-4")}>
      <div className="relative aspect-[21/9] overflow-hidden border border-line bg-ivory/40">
        <ProductImage src={banner.image} alt={banner.title || "Banner preview"} fill sizes="(max-width: 768px) 100vw, 640px" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#2a1715]/85 via-[#2a1715]/25 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4 text-ivory md:p-6">
          <p className="font-serif text-xl md:text-2xl">{banner.title || "Banner title"}</p>
          <p className="mt-2 max-w-md text-sm text-white/80">{banner.description || "Banner description"}</p>
          <span className="btn-primary mt-4 inline-flex pointer-events-none">{banner.cta || "Button"}</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-[11px] tracking-widest uppercase text-ink-soft">Title</span>
          <input
            required
            value={banner.title}
            onChange={(e) => onChange({ ...banner, title: e.target.value })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-[11px] tracking-widest uppercase text-ink-soft">Description</span>
          <textarea
            value={banner.description}
            onChange={(e) => onChange({ ...banner, description: e.target.value })}
            className="mt-1 min-h-20 w-full border border-line bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] tracking-widest uppercase text-ink-soft">Button link</span>
          <input
            value={banner.href}
            onChange={(e) => onChange({ ...banner, href: e.target.value })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] tracking-widest uppercase text-ink-soft">Button label</span>
          <input
            value={banner.cta}
            onChange={(e) => onChange({ ...banner, cta: e.target.value })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] tracking-widest uppercase text-ink-soft">Placement</span>
          <select
            value={banner.placement}
            onChange={(e) => onChange({ ...banner, placement: e.target.value as Banner["placement"] })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2 text-sm"
          >
            <option value="hero">Hero (homepage top)</option>
            <option value="promo">Promo block</option>
            <option value="strip">Strip</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] tracking-widest uppercase text-ink-soft">Device</span>
          <select
            value={banner.device}
            onChange={(e) => onChange({ ...banner, device: e.target.value as Banner["device"] })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2 text-sm"
          >
            <option value="all">All devices</option>
            <option value="desktop">Desktop only</option>
            <option value="mobile">Mobile only</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] tracking-widest uppercase text-ink-soft">Start date</span>
          <input
            type="date"
            value={banner.startsAt ?? ""}
            onChange={(e) => onChange({ ...banner, startsAt: e.target.value || undefined })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] tracking-widest uppercase text-ink-soft">End date</span>
          <input
            type="date"
            value={banner.endsAt ?? ""}
            onChange={(e) => onChange({ ...banner, endsAt: e.target.value || undefined })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] tracking-widest uppercase text-ink-soft">Display order</span>
          <input
            type="number"
            min={1}
            value={banner.order}
            onChange={(e) => onChange({ ...banner, order: Number(e.target.value) || 1 })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={banner.enabled}
            onChange={(e) => onChange({ ...banner, enabled: e.target.checked })}
          />
          Live on storefront
        </label>
      </div>

      <div>
        <p className="text-[11px] tracking-widest uppercase text-ink-soft">Banner image</p>
        <div className="mt-2 grid max-h-56 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
          {images.map((src) => (
            <button
              key={src}
              type="button"
              onClick={() => onChange({ ...banner, image: src })}
              className={cn(
                "relative aspect-square overflow-hidden border-2 transition",
                banner.image === src ? "border-ink" : "border-transparent hover:border-line",
              )}
            >
              <ProductImage src={src} alt="" fill sizes="80px" />
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary">
          {saveLabel}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="btn-outline">
            Cancel
          </button>
        ) : null}
        {saved ? <span className="text-sm text-ink-soft">Saved — visible on homepage after refresh.</span> : null}
      </div>
    </form>
  );
}

export function pickHeroBanner(banners: Banner[], now = new Date()) {
  const today = now.toISOString().slice(0, 10);

  function inSchedule(banner: Banner) {
    if (banner.startsAt && today < banner.startsAt.slice(0, 10)) return false;
    if (banner.endsAt && today > banner.endsAt.slice(0, 10)) return false;
    return true;
  }

  const live = banners
    .filter((b) => b.enabled && b.placement === "hero" && inSchedule(b))
    .sort((a, b) => a.order - b.order);

  // Scheduled campaign heroes take over the homepage while their window is active.
  const scheduled = live.filter((b) => Boolean(b.startsAt || b.endsAt));
  if (scheduled.length) return scheduled[0];

  // Never fall back to disabled / out-of-window / wrong-placement creatives.
  return live[0] ?? null;
}

/** All live homepage promo blocks (Admin → Banners → placement "promo"). */
export function pickPromoBanners(banners: Banner[], now = new Date()) {
  const today = now.toISOString().slice(0, 10);

  function inSchedule(banner: Banner) {
    if (banner.startsAt && today < banner.startsAt.slice(0, 10)) return false;
    if (banner.endsAt && today > banner.endsAt.slice(0, 10)) return false;
    return true;
  }

  return banners
    .filter((b) => b.enabled && b.placement === "promo" && inSchedule(b))
    .sort((a, b) => a.order - b.order);
}

/** @deprecated Prefer pickPromoBanners — kept for single-banner call sites. */
export function pickPromoBanner(banners: Banner[], now = new Date()) {
  return pickPromoBanners(banners, now)[0] ?? null;
}

/** Optional thin strip banners under the hero. */
export function pickStripBanners(banners: Banner[], now = new Date()) {
  const today = now.toISOString().slice(0, 10);

  function inSchedule(banner: Banner) {
    if (banner.startsAt && today < banner.startsAt.slice(0, 10)) return false;
    if (banner.endsAt && today > banner.endsAt.slice(0, 10)) return false;
    return true;
  }

  return banners
    .filter((b) => b.enabled && b.placement === "strip" && inSchedule(b))
    .sort((a, b) => a.order - b.order);
}
