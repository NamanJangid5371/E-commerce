"use client";

import type { CmsPage } from "@/data/admin-ops";
import { slugify } from "@/lib/media";
import { useShopStore } from "@/store/shop-store";
import { FormEvent, useState } from "react";

export default function PagesAdmin() {
  const ops = useShopStore((s) => s.ops);
  const setOps = useShopStore((s) => s.setOps);
  const [form, setForm] = useState<CmsPage>({
    slug: "",
    title: "",
    body: "",
    published: true,
    seoTitle: "",
    seoDescription: "",
  });

  function save(e: FormEvent) {
    e.preventDefault();
    const slug = form.slug || slugify(form.title);
    const row = { ...form, slug };
    const exists = ops.pages.some((p) => p.slug === slug);
    setOps({ ...ops, pages: exists ? ops.pages.map((p) => (p.slug === slug ? row : p)) : [...ops.pages, row] });
  }

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Pages & information</h1>
        <p className="mt-1 text-sm text-ink-soft">About, contact, policies, FAQ and custom pages.</p>
        <form onSubmit={save} className="mt-6 space-y-3">
          <input required placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value, slug: slugify(e.target.value) })} className="w-full border border-line bg-transparent px-3 py-2" />
          <input placeholder="Slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} className="w-full border border-line bg-transparent px-3 py-2" />
          <textarea required placeholder="Body" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="min-h-40 w-full border border-line bg-transparent px-3 py-2" />
          <input placeholder="SEO title" value={form.seoTitle} onChange={(e) => setForm({ ...form, seoTitle: e.target.value })} className="w-full border border-line bg-transparent px-3 py-2" />
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} /> Published</label>
          <button className="bg-ink px-5 py-2 text-xs uppercase tracking-widest text-ivory">Save page</button>
        </form>
      </div>
      <div className="space-y-3">
        {ops.pages.map((p) => (
          <div key={p.slug} className="border border-line p-4">
            <p className="font-medium">{p.title}</p>
            <p className="text-sm text-ink-soft">/{p.slug} · {p.published ? "published" : "draft"}</p>
            <button className="mt-2 text-xs uppercase tracking-widest" onClick={() => setForm(p)}>Edit</button>
          </div>
        ))}
      </div>
    </div>
  );
}
