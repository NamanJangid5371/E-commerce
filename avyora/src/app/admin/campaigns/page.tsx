"use client";

import type { Campaign } from "@/store/shop-types";
import { MEDIA_LIBRARY } from "@/lib/media";
import { useShopStore } from "@/store/shop-store";
import { FormEvent, useState } from "react";

export default function CampaignsAdmin() {
  const campaigns = useShopStore((s) => s.campaigns);
  const upsertCampaign = useShopStore((s) => s.upsertCampaign);
  const [form, setForm] = useState<Campaign>({
    id: `camp-${Date.now()}`,
    title: "",
    body: "",
    image: MEDIA_LIBRARY[22],
    href: "/shop",
    active: true,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    upsertCampaign(form);
    setForm({ id: `camp-${Date.now()}`, title: "", body: "", image: MEDIA_LIBRARY[22], href: "/shop", active: true });
  }

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Campaigns</h1>
        <p className="mt-1 text-sm text-ink-soft">The first active campaign appears on the homepage.</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <input
            required
            placeholder="Title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full border border-line bg-transparent px-3 py-2"
          />
          <textarea
            required
            placeholder="Body"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            className="min-h-24 w-full border border-line bg-transparent px-3 py-2"
          />
          <input
            placeholder="Link"
            value={form.href}
            onChange={(e) => setForm({ ...form, href: e.target.value })}
            className="w-full border border-line bg-transparent px-3 py-2"
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active
          </label>
          <select
            value={form.type ?? "seasonal"}
            onChange={(e) => setForm({ ...form, type: e.target.value as Campaign["type"] })}
            className="w-full border border-line bg-transparent px-3 py-2"
          >
            <option value="seasonal">Seasonal</option>
            <option value="flash">Flash sale</option>
            <option value="product">Product</option>
            <option value="category">Category</option>
            <option value="bogo">BOGO</option>
          </select>
          <input type="date" value={form.startsAt ?? ""} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className="w-full border border-line bg-transparent px-3 py-2" />
          <input type="date" value={form.endsAt ?? ""} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} className="w-full border border-line bg-transparent px-3 py-2" />
          <button className="bg-ink px-5 py-2 text-xs uppercase tracking-widest text-ivory">Save campaign</button>
        </form>
      </div>
      <div className="space-y-3">
        {campaigns.map((c) => (
          <div key={c.id} className="border border-line p-4">
            <p className="font-medium">{c.title}</p>
            <p className="text-sm text-ink-soft">{c.active ? "Live on homepage" : "Off"}</p>
            <button className="mt-2 text-xs uppercase tracking-widest" onClick={() => setForm(c)}>
              Edit
            </button>
            <button
              className="ml-4 text-xs uppercase tracking-widest"
              onClick={() => upsertCampaign({ ...c, active: !c.active })}
            >
              Toggle
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
