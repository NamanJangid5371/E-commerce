"use client";

import { fetchJson } from "@/lib/api-client";
import { useEffect, useState } from "react";

type Consignment = {
  id: string;
  reference?: string | null;
  status: string;
  consignorName?: string | null;
  createdAt: string;
};

export default function ConsignmentsAdmin() {
  const [rows, setRows] = useState<Consignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchJson<Consignment[]>("/api/admin/consignments");
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
      <h1 className="text-3xl font-medium tracking-tight">Consignments</h1>
      <p className="mt-1 text-sm text-ink-soft">Pieces held on consignment from partner ateliers.</p>

      {offline && (
        <p className="mt-6 border border-line bg-ivory/70 px-4 py-3 text-sm text-ink-soft">
          Consignment inventory syncs when the database is online.
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-ink-soft">Loading consignments…</p>
      ) : rows.length ? (
        <div className="mt-8 space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{row.reference || row.id}</p>
                <span className="text-xs tracking-widest uppercase text-ink-soft">{row.status}</span>
              </div>
              <p className="mt-1 text-sm text-ink-soft">{row.consignorName || "Consignor"}</p>
              <p className="mt-1 text-xs text-ink-soft">{new Date(row.createdAt).toLocaleString("en-IN")}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-8 border border-line p-8 text-center">
          <p className="text-sm text-ink-soft">No consignments on record.</p>
          <p className="mt-2 text-xs text-ink-soft">Incoming consignment pieces will appear here.</p>
        </div>
      )}
    </div>
  );
}
