"use client";

import { fetchJson, isApiOffline } from "@/lib/api-client";
import { useEffect, useState } from "react";

type Analytics = {
  periodDays: number;
  impressions: number;
  clicks: number;
  ctr: number;
  addToCartAfterClick: number;
  purchasesAfterClick: number;
  conversionRate: number;
  revenueAttributed: null;
  note?: string;
  byContext: { context: string; impressions: number; clicks: number; ctr: number }[];
  topClickedProducts: { productId: string; name: string | null; clicks: number }[];
};

export default function RecommendationAnalyticsAdmin() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const res = await fetchJson<Analytics>(`/api/admin/analytics/recommendations?days=${days}`);
      if (cancelled) return;
      setLoading(false);
      if (!res.ok || isApiOffline(res)) {
        setError(res.ok ? "Unavailable" : res.error);
        setData(null);
        return;
      }
      setData(res.data);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Recommendation analytics</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Aggregated performance of personalized recommendations (no per-customer browsing history).
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            className={`border px-4 py-2 text-xs uppercase tracking-widest ${
              days === d ? "border-ink bg-ink text-ivory" : "border-line"
            }`}
          >
            {d} days
          </button>
        ))}
      </div>

      {loading && <p className="mt-8 text-sm text-ink-soft">Loading…</p>}
      {error && <p className="mt-8 text-sm text-red-800">{error}</p>}

      {data && (
        <>
          <div className="mt-8 grid gap-4 md:grid-cols-5">
            {[
              ["Impressions", String(data.impressions)],
              ["Clicks", String(data.clicks)],
              ["CTR", `${(data.ctr * 100).toFixed(1)}%`],
              ["ATC (period)", String(data.addToCartAfterClick)],
              ["Conv. rate", `${(data.conversionRate * 100).toFixed(1)}%`],
            ].map(([k, v]) => (
              <div key={k} className="border border-line p-4">
                <p className="text-[11px] uppercase tracking-widest text-gold-deep">{k}</p>
                <p className="mt-2 text-2xl font-medium">{v}</p>
              </div>
            ))}
          </div>

          {data.note ? <p className="mt-4 text-xs text-ink-soft">{data.note}</p> : null}

          <div className="mt-10 grid gap-8 lg:grid-cols-2">
            <div>
              <h2 className="text-lg font-medium">By context</h2>
              <table className="mt-4 w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-widest text-ink-soft">
                    <th className="py-2">Context</th>
                    <th>Impr.</th>
                    <th>Clicks</th>
                    <th>CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byContext.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-4 text-ink-soft">
                        No recommendation events yet.
                      </td>
                    </tr>
                  ) : (
                    data.byContext.map((row) => (
                      <tr key={row.context} className="border-b border-line/60">
                        <td className="py-2">{row.context}</td>
                        <td>{row.impressions}</td>
                        <td>{row.clicks}</td>
                        <td>{(row.ctr * 100).toFixed(1)}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div>
              <h2 className="text-lg font-medium">Top clicked recommendations</h2>
              <ul className="mt-4 space-y-2 text-sm">
                {data.topClickedProducts.length === 0 ? (
                  <li className="text-ink-soft">No clicks yet.</li>
                ) : (
                  data.topClickedProducts.map((p) => (
                    <li key={p.productId} className="flex justify-between border-b border-line/60 py-2">
                      <span>{p.name ?? p.productId}</span>
                      <span className="text-ink-soft">{p.clicks}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
