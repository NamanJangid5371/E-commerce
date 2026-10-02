"use client";

import { formatINR } from "@/lib/format";
import { labelReturnStatus } from "@/lib/return-labels";
import { fetchLogisticsReturns, type ReturnDto } from "@/lib/returns-api";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export default function LogisticsReturnsPage() {
  const [rows, setRows] = useState<ReturnDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchLogisticsReturns({ q: q.trim() || undefined });
    if (!res.ok) {
      setError(res.error || "Could not load returns.");
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(res.data.returns);
    setError("");
    setLoading(false);
  }, [q]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-gold-deep">Logistics</p>
        <h1 className="mt-1 text-3xl font-medium tracking-tight">Return pickups</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Approved customer returns — schedule pickup, confirm warehouse receipt, then confirm
          inspection here. Refunds are handled in admin after inspection is confirmed.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search RMA, order, SKU…"
          className="min-w-[220px] flex-1 border border-line bg-transparent px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void load()}
          className="border border-line px-4 py-2 text-[11px] uppercase tracking-widest"
        >
          Refresh
        </button>
      </div>

      {loading && <p className="text-sm text-ink-soft">Loading…</p>}
      {error && <p className="text-sm text-rose-800">{error}</p>}

      <div className="space-y-3">
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/logistics/returns/${r.id}`}
            className="block rounded-3xl border border-line bg-paper/60 p-4 transition hover:border-ink"
          >
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <p className="font-medium">{r.returnNumber}</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {r.item.name} · {r.item.sku} · Order {r.orderId}
                </p>
              </div>
              <div className="text-right text-sm">
                <p>{labelReturnStatus(r.status)}</p>
                <p className="text-ink-soft">{formatINR(r.estimatedRefundAmount)}</p>
              </div>
            </div>
          </Link>
        ))}
        {!loading && !rows.length && (
          <p className="text-sm text-ink-soft">No approved returns in the logistics queue.</p>
        )}
      </div>
    </div>
  );
}
