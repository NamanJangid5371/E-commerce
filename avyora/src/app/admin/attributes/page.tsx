"use client";

import { useShopStore } from "@/store/shop-store";
import { FormEvent, useState } from "react";

export default function AttributesAdmin() {
  const ops = useShopStore((s) => s.ops);
  const setOps = useShopStore((s) => s.setOps);
  const [name, setName] = useState("");
  const [values, setValues] = useState("");

  function save(e: FormEvent) {
    e.preventDefault();
    setOps({
      ...ops,
      attributes: [...ops.attributes, { id: `attr-${Date.now()}`, name, values: values.split(",").map((v) => v.trim()).filter(Boolean) }],
    });
    setName("");
    setValues("");
  }

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Product attributes & variants</h1>
      <p className="mt-1 text-sm text-ink-soft">Define size, colour, metal and other combinable attributes. Variant SKUs, prices and stock are edited on each product.</p>
      <form onSubmit={save} className="mt-6 flex max-w-xl flex-col gap-3">
        <input required placeholder="Attribute name" value={name} onChange={(e) => setName(e.target.value)} className="border border-line bg-transparent px-3 py-2" />
        <input required placeholder="Values, comma separated" value={values} onChange={(e) => setValues(e.target.value)} className="border border-line bg-transparent px-3 py-2" />
        <button className="w-fit bg-ink px-5 py-2 text-xs uppercase tracking-widest text-ivory">Add attribute</button>
      </form>
      <div className="mt-8 space-y-3">
        {ops.attributes.map((a) => (
          <div key={a.id} className="flex justify-between border border-line p-4">
            <div>
              <p className="font-medium">{a.name}</p>
              <p className="text-sm text-ink-soft">{a.values.join(" · ")}</p>
            </div>
            <button
              className="text-xs uppercase tracking-widest"
              onClick={() => setOps({ ...ops, attributes: ops.attributes.filter((x) => x.id !== a.id) })}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
