"use client";

import { ProductImage } from "@/components/product-image";
import { MEDIA_LIBRARY } from "@/lib/media";
import { useShopStore } from "@/store/shop-store";
import { FormEvent, useState } from "react";

export default function MediaAdmin() {
  const extra = useShopStore((s) => s.mediaUrls);
  const addMediaUrl = useShopStore((s) => s.addMediaUrl);
  const [url, setUrl] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    addMediaUrl(url.trim());
    setUrl("");
  }

  const all = [...extra, ...MEDIA_LIBRARY];

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Media library</h1>
      <p className="mt-1 text-sm text-ink-soft">Local product photos plus any extra image URLs you add.</p>
      <form onSubmit={onSubmit} className="mt-6 flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="/products/ring-1.jpg or https://…"
          className="flex-1 border border-line bg-transparent px-3 py-2 text-sm"
        />
        <button className="bg-ink px-4 py-2 text-xs uppercase tracking-widest text-ivory">Add</button>
      </form>
      <div className="mt-8 grid grid-cols-3 gap-3 md:grid-cols-6">
        {all.map((src) => (
          <div key={src} className="relative aspect-square overflow-hidden bg-ivory">
            <ProductImage src={src} alt="" fill />
          </div>
        ))}
      </div>
    </div>
  );
}
