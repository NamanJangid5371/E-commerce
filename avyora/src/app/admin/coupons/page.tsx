"use client";

import type { Coupon } from "@/data/types";
import { useShopStore } from "@/store/shop-store";
import { FormEvent, useState } from "react";

export default function CouponsAdmin() {
  const coupons = useShopStore((s) => s.coupons);
  const upsertCoupon = useShopStore((s) => s.upsertCoupon);
  const deleteCoupon = useShopStore((s) => s.deleteCoupon);
  const [form, setForm] = useState<Coupon>({
    code: "",
    type: "percent",
    value: 10,
    minOrder: 0,
    label: "",
    active: true,
    usageCount: 0,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    upsertCoupon({ ...form, code: form.code.toUpperCase() });
    setForm({ code: "", type: "percent", value: 10, minOrder: 0, label: "", active: true, usageCount: 0 });
  }

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Coupons</h1>
        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <input
            required
            placeholder="Code"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            className="w-full border border-line bg-transparent px-3 py-2"
          />
          <input
            required
            placeholder="Label"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            className="w-full border border-line bg-transparent px-3 py-2"
          />
          <div className="grid grid-cols-2 gap-3">
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as Coupon["type"] })}
              className="border border-line bg-transparent px-3 py-2"
            >
            <option value="percent">Percent</option>
            <option value="flat">Flat ₹</option>
            <option value="free_shipping">Free shipping</option>
            </select>
            <input
              type="number"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: Number(e.target.value) })}
              className="border border-line bg-transparent px-3 py-2"
            />
          </div>
          <input
            type="number"
            placeholder="Min order"
            value={form.minOrder}
            onChange={(e) => setForm({ ...form, minOrder: Number(e.target.value) })}
            className="w-full border border-line bg-transparent px-3 py-2"
          />
          <input type="number" placeholder="Usage limit" value={form.usageLimit ?? ""} onChange={(e) => setForm({ ...form, usageLimit: e.target.value ? Number(e.target.value) : undefined })} className="w-full border border-line bg-transparent px-3 py-2" />
          <input type="date" value={form.startsAt ?? ""} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className="w-full border border-line bg-transparent px-3 py-2" />
          <input type="date" value={form.endsAt ?? ""} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} className="w-full border border-line bg-transparent px-3 py-2" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active
          </label>
          <button className="bg-ink px-5 py-2 text-xs uppercase tracking-widest text-ivory">Save coupon</button>
        </form>
      </div>
      <div className="space-y-3">
        {coupons.map((c) => (
          <div key={c.code} className="flex items-start justify-between border border-line p-4">
            <div>
              <p className="font-medium tracking-widest">{c.code}</p>
              <p className="text-sm text-ink-soft">
                {c.label} · used {c.usageCount ?? 0} · {c.active === false ? "inactive" : "active"}
              </p>
            </div>
            <div className="space-x-3 text-xs uppercase tracking-widest">
              <button onClick={() => setForm(c)}>Edit</button>
              <button onClick={() => upsertCoupon({ ...c, active: c.active === false })}>
                {c.active === false ? "Enable" : "Disable"}
              </button>
              <button onClick={() => deleteCoupon(c.code)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
