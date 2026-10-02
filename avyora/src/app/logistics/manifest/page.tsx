"use client";

import { formatINR } from "@/lib/format";
import { fetchLogisticsOrders } from "@/lib/logistics-api";
import { codToCollect, readyToShip } from "@/lib/logistics-orders";
import { useShopStore } from "@/store/shop-store";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export default function LogisticsManifestPage() {
  const orders = useShopStore((s) => s.orders);
  const mergeOrders = useShopStore((s) => s.mergeOrders);
  const partners = useShopStore((s) => s.ops.deliveryPartners);
  const [loading, setLoading] = useState(true);
  const [partner, setPartner] = useState("all");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchLogisticsOrders({ pageSize: 100 });
      if (cancelled) return;
      if (res.ok && res.data?.orders?.length) mergeOrders(res.data.orders);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [mergeOrders]);

  const handover = useMemo(
    () =>
      orders
        .filter(readyToShip)
        .sort((a, b) => a.address.pincode.localeCompare(b.address.pincode)),
    [orders],
  );

  const partnerNames = useMemo(
    () =>
      Array.from(
        new Set([
          ...partners.filter((entry) => entry.active).map((entry) => entry.name),
          ...handover.map((order) => order.deliveryPartner).filter(Boolean),
        ]),
      ).sort() as string[],
    [handover, partners],
  );

  const rows = handover.filter((order) => partner === "all" || (order.deliveryPartner ?? "Unassigned") === partner);
  const codTotal = rows.reduce((sum, order) => sum + codToCollect(order), 0);
  const printedAt = new Date().toLocaleString("en-IN");

  return (
    <div className="space-y-6">
      <div className="logistics-no-print flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">Courier manifest</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Packed and ready-to-ship parcels for handover. Print one sheet per courier.
          </p>
        </div>
        <button type="button" onClick={() => window.print()} className="btn-primary">
          Print manifest
        </button>
      </div>

      <div className="logistics-no-print flex flex-wrap items-center gap-3">
        <label className="text-sm">
          Courier
          <select
            value={partner}
            onChange={(e) => setPartner(e.target.value)}
            className="ml-2 border border-line bg-transparent px-3 py-2 text-sm"
          >
            <option value="all">All couriers</option>
            <option value="Unassigned">Unassigned</option>
            {partnerNames.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <p className="text-sm text-ink-soft">
          {loading ? "Loading…" : `${rows.length} parcels · COD ${formatINR(codTotal)}`}
        </p>
      </div>

      <section className="rounded-3xl border border-line bg-paper/70 p-5 print:rounded-none print:border-0 print:bg-white print:p-0">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] tracking-[0.16em] uppercase text-gold-deep">Avyora handover</p>
            <h2 className="mt-1 text-2xl font-medium">{partner === "all" ? "All couriers" : partner}</h2>
          </div>
          <p className="text-xs text-ink-soft">{printedAt}</p>
        </div>

        {!loading && rows.length === 0 ? (
          <p className="mt-6 text-sm text-ink-soft">
            No parcels are packed yet.{" "}
            <Link href="/logistics/pack" className="logistics-no-print underline">
              Open the packing desk
            </Link>
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] tracking-[0.14em] uppercase text-ink-soft">
                  <th className="py-2 pr-3 font-medium">Order</th>
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 pr-3 font-medium">Pincode</th>
                  <th className="py-2 pr-3 font-medium">AWB</th>
                  <th className="py-2 pr-3 font-medium">Courier</th>
                  <th className="py-2 text-right font-medium">COD</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => {
                  const due = codToCollect(order);
                  return (
                    <tr key={order.id} className="border-b border-line">
                      <td className="py-3 pr-3">
                        <Link href={`/logistics/orders/${order.id}`} className="font-medium">
                          {order.id}
                        </Link>
                        <p className="text-xs text-ink-soft">{order.status}</p>
                      </td>
                      <td className="py-3 pr-3">
                        {order.address.name}
                        <p className="text-xs text-ink-soft">
                          {order.address.city} · {order.address.phone}
                        </p>
                      </td>
                      <td className="py-3 pr-3">{order.address.pincode}</td>
                      <td className="py-3 pr-3">{order.trackingId ?? "—"}</td>
                      <td className="py-3 pr-3">{order.deliveryPartner ?? "Unassigned"}</td>
                      <td className="py-3 text-right">{due ? formatINR(due) : "Prepaid"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <p className="mt-4 text-sm">
            {rows.length} parcels · Cash to collect {formatINR(codTotal)}
          </p>
        )}
        <p className="mt-2 text-xs text-ink-soft">
          Courier signature confirms the parcels above were handed over. Tracking numbers are entered by the desk; they are not fetched from the carrier.
        </p>
      </section>
    </div>
  );
}
