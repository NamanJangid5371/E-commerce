"use client";

import { fetchJson } from "@/lib/api-client";
import { useEffect, useState } from "react";

type CertificateRow = {
  id: string;
  number: string;
  type: string;
  issueDate?: string | null;
  product?: { name?: string } | null;
};

export default function CertificatesAdmin() {
  const [rows, setRows] = useState<CertificateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchJson<CertificateRow[]>("/api/admin/certificates");
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
      <h1 className="text-3xl font-medium tracking-tight">Certificates</h1>
      <p className="mt-1 text-sm text-ink-soft">Hallmark and gem certificates issued to clients.</p>

      {offline && (
        <p className="mt-6 border border-line bg-ivory/70 px-4 py-3 text-sm text-ink-soft">
          Certificate registry syncs when the database is online.
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-ink-soft">Loading certificates…</p>
      ) : rows.length ? (
        <div className="mt-8 space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="border border-line p-4">
              <p className="font-medium">{row.number}</p>
              <p className="mt-1 text-sm text-ink-soft">
                {row.type}
                {row.product?.name ? ` · ${row.product.name}` : ""}
              </p>
              {row.issueDate && (
                <p className="mt-1 text-xs text-ink-soft">Issued {new Date(row.issueDate).toLocaleDateString("en-IN")}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-8 border border-line p-8 text-center">
          <p className="text-sm text-ink-soft">No certificates on file yet.</p>
          <p className="mt-2 text-xs text-ink-soft">Issued certificates will appear here once connected.</p>
        </div>
      )}
    </div>
  );
}
