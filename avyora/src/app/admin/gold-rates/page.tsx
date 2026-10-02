"use client";

import { fetchJson } from "@/lib/api-client";
import { formatINR } from "@/lib/format";
import { useEffect, useState } from "react";

type GoldRate = {
  id: string;
  purity: string;
  ratePerGram: number;
  unit: string;
  source?: string | null;
  effectiveAt: string;
};

export default function GoldRatesAdmin() {
  const [rates, setRates] = useState<GoldRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchJson<GoldRate[]>("/api/admin/gold-rates");
      if (cancelled) return;
      if (res.ok) {
        setRates(Array.isArray(res.data) ? res.data : []);
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
      <h1 className="text-3xl font-medium tracking-tight">Gold rates</h1>
      <p className="mt-1 text-sm text-ink-soft">Daily bullion rates used for dynamic pricing.</p>

      {offline && (
        <p className="mt-6 border border-line bg-ivory/70 px-4 py-3 text-sm text-ink-soft">
          Gold rate feed syncs when the database is online.
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-ink-soft">Loading rates…</p>
      ) : rates.length ? (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] tracking-widest uppercase text-ink-soft">
                <th className="py-2 pr-4">Purity</th>
                <th className="py-2 pr-4">Rate / gram</th>
                <th className="py-2 pr-4">Source</th>
                <th className="py-2">Effective</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((rate) => (
                <tr key={rate.id} className="border-b border-line">
                  <td className="py-3 pr-4 font-medium">{rate.purity}</td>
                  <td className="py-3 pr-4">{formatINR(rate.ratePerGram)}</td>
                  <td className="py-3 pr-4 text-ink-soft">{rate.source || "—"}</td>
                  <td className="py-3 text-ink-soft">{new Date(rate.effectiveAt).toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-8 border border-line p-8 text-center">
          <p className="text-sm text-ink-soft">No gold rates recorded yet.</p>
          <p className="mt-2 text-xs text-ink-soft">Add rates via the API when the database is connected.</p>
        </div>
      )}
    </div>
  );
}
