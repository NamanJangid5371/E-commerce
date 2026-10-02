"use client";

import type { ShippingMethod } from "@/data/admin-ops";
import { formatINR } from "@/lib/format";
import { useShopStore } from "@/store/shop-store";
import { FormEvent, useState } from "react";

export default function ShippingAdmin() {
  const ops = useShopStore((s) => s.ops);
  const setOps = useShopStore((s) => s.setOps);
  const [form, setForm] = useState<ShippingMethod>({
    id: `ship-${Date.now()}`,
    name: "",
    carrier: "",
    charge: 199,
    freeAbove: 7999,
    eta: "3–7 working days",
    zones: "Pan India",
    enabled: true,
  });

  function save(e: FormEvent) {
    e.preventDefault();
    const exists = ops.shippingMethods.some((s) => s.id === form.id);
    setOps({
      ...ops,
      shippingMethods: exists
        ? ops.shippingMethods.map((s) => (s.id === form.id ? form : s))
        : [...ops.shippingMethods, form],
    });
  }

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Shipping & delivery</h1>
        <p className="mt-1 text-sm text-ink-soft">Methods, charges, free-shipping threshold, zones and ETAs.</p>
        <form onSubmit={save} className="mt-6 space-y-3">
          <input required placeholder="Method name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-line bg-transparent px-3 py-2" />
          <input placeholder="Carrier" value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} className="w-full border border-line bg-transparent px-3 py-2" />
          <input type="number" placeholder="Charge" value={form.charge} onChange={(e) => setForm({ ...form, charge: Number(e.target.value) })} className="w-full border border-line bg-transparent px-3 py-2" />
          <input type="number" placeholder="Free above" value={form.freeAbove} onChange={(e) => setForm({ ...form, freeAbove: Number(e.target.value) })} className="w-full border border-line bg-transparent px-3 py-2" />
          <input placeholder="ETA" value={form.eta} onChange={(e) => setForm({ ...form, eta: e.target.value })} className="w-full border border-line bg-transparent px-3 py-2" />
          <input placeholder="Zones" value={form.zones} onChange={(e) => setForm({ ...form, zones: e.target.value })} className="w-full border border-line bg-transparent px-3 py-2" />
          <button className="bg-ink px-5 py-2 text-xs uppercase tracking-widest text-ivory">Save method</button>
        </form>
        <p className="mt-4 text-sm text-ink-soft">Store-wide free shipping also lives in Settings ({formatINR(ops.settings.freeShippingMin)}).</p>
      </div>
      <div className="space-y-3">
        {ops.shippingMethods.map((s) => (
          <div key={s.id} className="border border-line p-4">
            <p className="font-medium">{s.name}</p>
            <p className="text-sm text-ink-soft">
              {s.carrier} · {formatINR(s.charge)} · free over {formatINR(s.freeAbove)} · {s.eta}
            </p>
            <div className="mt-2 space-x-3 text-xs uppercase tracking-widest">
              <button onClick={() => setForm(s)}>Edit</button>
              <button
                onClick={() =>
                  setOps({
                    ...ops,
                    shippingMethods: ops.shippingMethods.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)),
                  })
                }
              >
                {s.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
