"use client";

import { fetchJson } from "@/lib/api-client";
import { useEffect, useState } from "react";

type BespokeOrder = {
  id: string;
  jewelleryType: string;
  status: string;
  metal?: string | null;
  stone?: string | null;
  createdAt: string;
  guestEmail?: string | null;
};

export default function BespokeAdmin() {
  const [orders, setOrders] = useState<BespokeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchJson<BespokeOrder[]>("/api/admin/bespoke");
      if (cancelled) return;
      if (res.ok) {
        setOrders(Array.isArray(res.data) ? res.data : []);
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
      <h1 className="text-3xl font-medium tracking-tight">Bespoke</h1>
      <p className="mt-1 text-sm text-ink-soft">Custom commission requests from clients and guests.</p>

      {offline && (
        <p className="mt-6 border border-line bg-ivory/70 px-4 py-3 text-sm text-ink-soft">
          Bespoke queue syncs when the database is online.
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-ink-soft">Loading bespoke requests…</p>
      ) : orders.length ? (
        <div className="mt-8 space-y-3">
          {orders.map((order) => (
            <div key={order.id} className="border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{order.jewelleryType}</p>
                <span className="text-xs tracking-widest uppercase text-ink-soft">{order.status}</span>
              </div>
              <p className="mt-1 text-sm text-ink-soft">
                {[order.metal, order.stone].filter(Boolean).join(" · ") || "Details pending"}
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                {new Date(order.createdAt).toLocaleString("en-IN")}
                {order.guestEmail ? ` · ${order.guestEmail}` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-8 border border-line p-8 text-center">
          <p className="text-sm text-ink-soft">No bespoke requests yet.</p>
          <p className="mt-2 text-xs text-ink-soft">Client commission submissions will appear here.</p>
        </div>
      )}
    </div>
  );
}
