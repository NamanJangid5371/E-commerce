"use client";

import type { MenuItem } from "@/data/admin-ops";
import { useShopStore } from "@/store/shop-store";
import { FormEvent, useState } from "react";

export default function MenusAdmin() {
  const ops = useShopStore((s) => s.ops);
  const setOps = useShopStore((s) => s.setOps);
  const [form, setForm] = useState<MenuItem>({
    id: `menu-${Date.now()}`,
    label: "",
    href: "/",
    location: "header",
    order: 10,
    enabled: true,
  });

  function save(e: FormEvent) {
    e.preventDefault();
    const exists = ops.menus.some((m) => m.id === form.id);
    setOps({ ...ops, menus: exists ? ops.menus.map((m) => (m.id === form.id ? form : m)) : [...ops.menus, form] });
    setForm({ id: `menu-${Date.now()}`, label: "", href: "/", location: "header", order: 10, enabled: true });
  }

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Menus & navigation</h1>
      <p className="mt-1 text-sm text-ink-soft">Header and footer links, including categories, pages and campaigns.</p>
      <form onSubmit={save} className="mt-6 grid max-w-3xl gap-3 md:grid-cols-2">
        <input required placeholder="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="border border-line bg-transparent px-3 py-2" />
        <input required placeholder="Href" value={form.href} onChange={(e) => setForm({ ...form, href: e.target.value })} className="border border-line bg-transparent px-3 py-2" />
        <select value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value as MenuItem["location"] })} className="border border-line bg-transparent px-3 py-2">
          <option value="header">Header</option>
          <option value="footer">Footer</option>
        </select>
        <input type="number" value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} className="border border-line bg-transparent px-3 py-2" />
        <button className="bg-ink px-5 py-2 text-xs uppercase tracking-widest text-ivory">Save item</button>
      </form>
      <div className="mt-8 grid gap-8 md:grid-cols-2">
        {(["header", "footer"] as const).map((loc) => (
          <div key={loc}>
            <h2 className="mb-3 font-medium capitalize">{loc}</h2>
            {ops.menus.filter((m) => m.location === loc).sort((a, b) => a.order - b.order).map((m) => (
              <div key={m.id} className="mb-2 flex justify-between border border-line p-3 text-sm">
                <span>
                  {m.label} → {m.href} {m.enabled ? "" : "(off)"}
                </span>
                <span className="space-x-3 text-xs uppercase tracking-widest">
                  <button onClick={() => setForm(m)}>Edit</button>
                  <button onClick={() => setOps({ ...ops, menus: ops.menus.map((x) => (x.id === m.id ? { ...x, enabled: !x.enabled } : x)) })}>Toggle</button>
                  <button onClick={() => setOps({ ...ops, menus: ops.menus.filter((x) => x.id !== m.id) })}>Delete</button>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
