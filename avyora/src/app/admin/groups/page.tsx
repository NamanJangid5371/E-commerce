"use client";

import type { CustomerGroup } from "@/data/admin-ops";
import { useShopStore } from "@/store/shop-store";
import { FormEvent, useState } from "react";

export default function GroupsAdmin() {
  const ops = useShopStore((s) => s.ops);
  const setOps = useShopStore((s) => s.setOps);
  const customers = useShopStore((s) => s.customers);
  const [form, setForm] = useState<CustomerGroup>({ id: `g-${Date.now()}`, name: "", discountPercent: 0, benefits: "" });

  function save(e: FormEvent) {
    e.preventDefault();
    const exists = ops.groups.some((g) => g.id === form.id);
    setOps({ ...ops, groups: exists ? ops.groups.map((g) => (g.id === form.id ? form : g)) : [...ops.groups, form] });
  }

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Customer groups</h1>
        <p className="mt-1 text-sm text-ink-soft">Regular, Premium, VIP, Wholesale — group discounts and benefits.</p>
        <form onSubmit={save} className="mt-6 space-y-3">
          <input required placeholder="Group name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-line bg-transparent px-3 py-2" />
          <input type="number" placeholder="Discount %" value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: Number(e.target.value) })} className="w-full border border-line bg-transparent px-3 py-2" />
          <textarea placeholder="Benefits" value={form.benefits} onChange={(e) => setForm({ ...form, benefits: e.target.value })} className="min-h-20 w-full border border-line bg-transparent px-3 py-2" />
          <button className="bg-ink px-5 py-2 text-xs uppercase tracking-widest text-ivory">Save group</button>
        </form>
      </div>
      <div className="space-y-3">
        {ops.groups.map((g) => (
          <div key={g.id} className="border border-line p-4">
            <p className="font-medium">{g.name} · {g.discountPercent}%</p>
            <p className="text-sm text-ink-soft">{g.benefits}</p>
            <p className="mt-1 text-xs">{customers.filter((c) => c.groupId === g.id).length} customers assigned</p>
            <button className="mt-2 text-xs uppercase tracking-widest" onClick={() => setForm(g)}>Edit</button>
          </div>
        ))}
      </div>
    </div>
  );
}
