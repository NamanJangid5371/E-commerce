"use client";

import { slugify } from "@/lib/media";
import { useShopStore } from "@/store/shop-store";
import type { CategoryRecord } from "@/data/admin-ops";
import Link from "next/link";
import { FormEvent, useState } from "react";

const blank = (): CategoryRecord => ({
  id: `cat-${Date.now()}`,
  name: "",
  slug: "",
  description: "",
  image: "/products/ring-1.jpg",
  banner: "/products/ring-5.jpg",
  order: 9,
  enabled: true,
  showInMenu: true,
  seoTitle: "",
  seoDescription: "",
});

export default function CategoriesAdmin() {
  const ops = useShopStore((s) => s.ops);
  const setOps = useShopStore((s) => s.setOps);
  const catalog = useShopStore((s) => s.catalog);
  const [form, setForm] = useState<CategoryRecord>(blank());

  function save(e: FormEvent) {
    e.preventDefault();
    const prev = ops.categories.find((c) => c.id === form.id);
    const row = { ...form, slug: form.slug || slugify(form.name), seoTitle: form.seoTitle || form.name };
    const exists = ops.categories.some((c) => c.id === row.id);

    // Keep products linked when category name changes
    let catalog = useShopStore.getState().catalog;
    if (prev && prev.name !== row.name) {
      const upsert = useShopStore.getState().upsertProduct;
      catalog
        .filter((p) => p.categoryId === row.id || p.category === prev.name)
        .forEach((p) => upsert({ ...p, category: row.name, categoryId: row.id }));
    }

    setOps({
      ...ops,
      categories: exists ? ops.categories.map((c) => (c.id === row.id ? row : c)) : [...ops.categories, row],
    });
    setForm(blank());
  }

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Categories</h1>
        <p className="mt-1 text-sm text-ink-soft">Create, nest, enable and SEO-tag shop categories.</p>
        <form onSubmit={save} className="mt-6 space-y-3">
          <input required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugify(e.target.value) })} className="w-full border border-line bg-transparent px-3 py-2" />
          <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-20 w-full border border-line bg-transparent px-3 py-2" />
          <input placeholder="Promo copy" value={form.promo ?? ""} onChange={(e) => setForm({ ...form, promo: e.target.value })} className="w-full border border-line bg-transparent px-3 py-2" />
          <input type="number" placeholder="Menu order" value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} className="w-full border border-line bg-transparent px-3 py-2" />
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled</label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.showInMenu} onChange={(e) => setForm({ ...form, showInMenu: e.target.checked })} /> Show in menus</label>
          <button className="bg-ink px-5 py-2 text-xs uppercase tracking-widest text-ivory">Save category</button>
        </form>
      </div>
      <div className="space-y-3">
        {ops.categories.sort((a, b) => a.order - b.order).map((c) => (
          <div key={c.id} className="border border-line p-4">
            <div className="flex justify-between">
              <p className="font-medium">{c.name}</p>
              <div className="space-x-3 text-xs uppercase tracking-widest">
                <button onClick={() => setForm(c)}>Edit</button>
                <button onClick={() => setOps({ ...ops, categories: ops.categories.filter((x) => x.id !== c.id) })}>Delete</button>
              </div>
            </div>
            <p className="text-sm text-ink-soft">
              {c.enabled ? "Live" : "Hidden"} · {catalog.filter((p) => p.categoryId === c.id || p.category === c.name).length} products · menu {c.showInMenu ? "on" : "off"}
            </p>
            <Link href={`/admin/products?category=${c.id}`} className="mt-2 inline-block text-xs underline">
              View products
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
