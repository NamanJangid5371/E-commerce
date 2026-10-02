"use client";

import { formatINR } from "@/lib/format";
import { fetchJson } from "@/lib/api-client";
import { useShopStore } from "@/store/shop-store";
import type { Customer } from "@/store/shop-types";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export default function AdminCustomers() {
  const storeCustomers = useShopStore((s) => s.customers);
  const orders = useShopStore((s) => s.orders);
  const [remote, setRemote] = useState<Customer[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const collected: Customer[] = [];
      let page = 1;
      let totalPages = 1;
      let lastError = "";
      while (page <= totalPages && page <= 20 && !cancelled) {
        const res = await fetchJson<{
          customers: Customer[];
          totalPages?: number;
        }>(`/api/admin/customers?page=${page}&limit=100`);
        if (!res.ok) {
          lastError = res.error;
          break;
        }
        collected.push(...(res.data.customers ?? []));
        totalPages = res.data.totalPages ?? 1;
        page += 1;
      }
      if (cancelled) return;
      if (collected.length) {
        setRemote(collected);
        useShopStore.setState({ customers: collected });
        setError("");
      } else {
        setRemote(null);
        setError(lastError || "Could not load customers from the database.");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const customers = remote ?? storeCustomers;

  const rows = useMemo(() => {
    return customers.map((c) => {
      const spent = orders
        .filter(
          (o) =>
            o.customerEmail?.toLowerCase() === c.email.toLowerCase() || o.address.name === c.name,
        )
        .reduce((s, o) => s + (o.status === "Refunded" ? 0 : o.total), 0);
      return { c, spent };
    });
  }, [customers, orders]);

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Customers</h1>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          Accounts from storefront registration and checkout (Postgres), plus any legacy profiles.
        </p>
        <button
          type="button"
          onClick={() => {
            const header = "name,email,phone,status,group\n";
            const csv = customers
              .map((c) => `${c.name},${c.email},${c.phone ?? ""},${c.status},${c.groupId ?? ""}`)
              .join("\n");
            const blob = new Blob([header + csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "avyora-customers.csv";
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="border border-line px-4 py-2 text-xs uppercase tracking-widest"
        >
          Export CSV
        </button>
      </div>
      {error && <p className="mt-4 text-sm text-red-800">{error}</p>}
      <div className="mt-8 divide-y divide-[var(--line)] border border-line">
        {loading && !customers.length && (
          <p className="px-4 py-8 text-sm text-ink-soft">Loading customers…</p>
        )}
        {rows.map(({ c, spent }) => (
          <Link
            key={c.id}
            href={`/admin/customers/${encodeURIComponent(c.id)}`}
            className="flex justify-between px-4 py-4 text-sm"
          >
            <div>
              <p className="font-medium">{c.name}</p>
              <p className="text-ink-soft">
                {c.email} · {c.status}
              </p>
            </div>
            <p>{formatINR(spent)}</p>
          </Link>
        ))}
        {!loading && !customers.length && (
          <p className="px-4 py-8 text-sm text-ink-soft">No customers yet.</p>
        )}
      </div>
    </div>
  );
}
