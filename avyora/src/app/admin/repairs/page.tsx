"use client";

import { fetchJson } from "@/lib/api-client";
import { useEffect, useState } from "react";

type RepairRow = {
  id: string;
  productName?: string | null;
  type: string;
  status: string;
  description: string;
  createdAt: string;
};

export default function RepairsAdmin() {
  const [rows, setRows] = useState<RepairRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchJson<RepairRow[]>("/api/admin/repairs");
      if (cancelled) return;
      if (res.ok) {
        setRows(Array.isArray(res.data) ? res.data : []);
        setOffline(false);
      } else if (res.offline) {
        setOffline(true);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Repairs</h1>
      <p className="mt-1 text-sm text-ink-soft">Customer repair and resizing requests from the atelier queue.</p>

      {offline && (
        <p className="mt-6 border border-line bg-ivory/70 px-4 py-3 text-sm text-ink-soft">
          Repair queue syncs when the database is online. Local demo orders are unchanged.
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-ink-soft">Loading repair requests…</p>
      ) : rows.length ? (
        <div className="mt-8 space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{row.productName || "Piece"}</p>
                <span className="text-xs tracking-widest uppercase text-ink-soft">{row.status}</span>
              </div>
              <p className="mt-1 text-xs text-ink-soft">
                {row.type} · {new Date(row.createdAt).toLocaleString("en-IN")}
              </p>
              <p className="mt-2 text-sm text-ink-soft">{row.description}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-8 border border-line p-8 text-center">
          <p className="text-sm text-ink-soft">No repair requests yet.</p>
          <p className="mt-2 text-xs text-ink-soft">New customer repair submissions will appear here.</p>
        </div>
      )}
    </div>
  );
}
