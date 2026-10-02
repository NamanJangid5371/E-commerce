"use client";

import type { AdminAccount } from "@/data/admin-ops";
import { useShopStore } from "@/store/shop-store";
import { FormEvent, useState } from "react";

export default function AdminUsersPage() {
  const ops = useShopStore((s) => s.ops);
  const setOps = useShopStore((s) => s.setOps);
  const [form, setForm] = useState<AdminAccount>({
    id: `adm-${Date.now()}`,
    name: "",
    email: "",
    role: "Catalog Manager",
    active: true,
    permissions: ["products"],
  });

  function save(e: FormEvent) {
    e.preventDefault();
    const exists = ops.adminUsers.some((u) => u.id === form.id);
    setOps({
      ...ops,
      adminUsers: exists ? ops.adminUsers.map((u) => (u.id === form.id ? form : u)) : [...ops.adminUsers, form],
    });
  }

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Admin users & roles</h1>
        <p className="mt-1 text-sm text-ink-soft">Create accounts, assign roles and disable access. Staff passwords are managed server-side and never shown here.</p>
        <form onSubmit={save} className="mt-6 space-y-3">
          <input required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-line bg-transparent px-3 py-2" />
          <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border border-line bg-transparent px-3 py-2" />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full border border-line bg-transparent px-3 py-2">
            <option>Super Admin</option>
            <option>Catalog Manager</option>
            <option>Order Manager</option>
            <option>Content Manager</option>
            <option>Marketing Manager</option>
          </select>
          <input
            placeholder="Permissions comma-separated"
            value={form.permissions.join(",")}
            onChange={(e) => setForm({ ...form, permissions: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
            className="w-full border border-line bg-transparent px-3 py-2"
          />
          <button className="bg-ink px-5 py-2 text-xs uppercase tracking-widest text-ivory">Save admin</button>
        </form>
      </div>
      <div className="space-y-3">
        {ops.adminUsers.map((u) => (
          <div key={u.id} className="border border-line p-4">
            <p className="font-medium">{u.name}</p>
            <p className="text-sm text-ink-soft">{u.email} · {u.role} · {u.active ? "active" : "disabled"}</p>
            <div className="mt-2 space-x-3 text-xs uppercase tracking-widest">
              <button onClick={() => setForm(u)}>Edit</button>
              <button
                onClick={() =>
                  setOps({ ...ops, adminUsers: ops.adminUsers.map((x) => (x.id === u.id ? { ...x, active: !x.active } : x)) })
                }
              >
                {u.active ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
