"use client";

import type { BrandRecord } from "@/data/admin-ops";
import { slugify } from "@/lib/media";
import { useShopStore } from "@/store/shop-store";
import { FormEvent, useState } from "react";

export default function BrandsAdmin() {
  const ops = useShopStore((s) => s.ops);
  const setOps = useShopStore((s) => s.setOps);
  const catalog = useShopStore((s) => s.catalog);
  const [form, setForm] = useState<BrandRecord>({
    id: `br-${Date.now()}`,
    name: "",
    slug: "",
    logo: "/products/necklace-1.jpg",
    description: "",
    enabled: true,
    seoTitle: "",
    seoDescription: "",
  });

  function save(e: FormEvent) {
    e.preventDefault();
    const row = { ...form, slug: form.slug || slugify(form.name) };
    const exists = ops.brands.some((b) => b.id === row.id);
    setOps({ ...ops, brands: exists ? ops.brands.map((b) => (b.id === row.id ? row : b)) : [...ops.brands, row] });
  }

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Brands</h1>
        <form onSubmit={save} className="mt-6 space-y-3">
          <input required placeholder="Brand name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugify(e.target.value) })} className="w-full border border-line bg-transparent px-3 py-2" />
          <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-20 w-full border border-line bg-transparent px-3 py-2" />
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled</label>
          <button className="bg-ink px-5 py-2 text-xs uppercase tracking-widest text-ivory">Save brand</button>
        </form>
      </div>
      <div className="space-y-3">
        {ops.brands.map((b) => (
          <div key={b.id} className="border border-line p-4">
            <p className="font-medium">{b.name}</p>
            <p className="text-sm text-ink-soft">{catalog.filter((p) => p.brand === b.name).length} products · {b.enabled ? "live" : "off"}</p>
            <button className="mt-2 text-xs uppercase tracking-widest" onClick={() => setForm(b)}>Edit</button>
          </div>
        ))}
      </div>
    </div>
  );
}
