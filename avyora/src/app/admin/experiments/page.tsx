"use client";

import { fetchJson } from "@/lib/api-client";
import { useEffect, useState } from "react";

type Experiment = {
  id: string;
  key: string;
  name: string;
  status: string;
  variants?: { id: string; name: string }[];
};

export default function ExperimentsAdmin() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchJson<Experiment[]>("/api/admin/experiments");
      if (cancelled) return;
      if (res.ok) {
        setExperiments(Array.isArray(res.data) ? res.data : []);
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
      <h1 className="text-3xl font-medium tracking-tight">Experiments</h1>
      <p className="mt-1 text-sm text-ink-soft">A/B tests and feature rollouts on the storefront.</p>

      {offline && (
        <p className="mt-6 border border-line bg-ivory/70 px-4 py-3 text-sm text-ink-soft">
          Experiment registry syncs when the database is online.
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-ink-soft">Loading experiments…</p>
      ) : experiments.length ? (
        <div className="mt-8 space-y-3">
          {experiments.map((exp) => (
            <div key={exp.id} className="border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{exp.name}</p>
                <span className="text-xs tracking-widest uppercase text-ink-soft">{exp.status}</span>
              </div>
              <p className="mt-1 text-sm text-ink-soft">{exp.key}</p>
              {exp.variants?.length ? (
                <p className="mt-2 text-xs text-ink-soft">{exp.variants.length} variant(s)</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-8 border border-line p-8 text-center">
          <p className="text-sm text-ink-soft">No experiments configured.</p>
          <p className="mt-2 text-xs text-ink-soft">Running A/B tests will list here once the API is available.</p>
        </div>
      )}
    </div>
  );
}
