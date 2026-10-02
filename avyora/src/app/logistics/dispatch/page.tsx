"use client";

import { formatINR } from "@/lib/format";
import { fetchDispatchOrders, type DispatchScope } from "@/lib/dispatch-api";
import { isCodPaymentMethod } from "@/lib/payment-method";
import { useShopStore } from "@/store/shop-store";
import type { Order } from "@/store/shop-types";
import Link from "next/link";
import { useEffect, useState } from "react";

/** Local dispatch — 3rd-party partners manage last-mile + COD only. */
export default function LocalDispatchQueuePage() {
  const mergeOrders = useShopStore((s) => s.mergeOrders);
  const [orders, setOrders] = useState<Order[]>([]);
  const [scope, setScope] = useState<DispatchScope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchDispatchOrders({ pageSize: 100 });
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error || "Could not load dispatch jobs.");
        setLoading(false);
        return;
      }
      setOrders(res.data.orders ?? []);
      setScope(res.data.scope);
      mergeOrders(res.data.orders ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [mergeOrders]);

  return (
    <div>
      <p className="text-[11px] uppercase tracking-widest text-gold-deep">Local dispatch</p>
      <h1 className="mt-1 text-3xl font-medium tracking-tight">Delivery partner desk</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-soft">
        Partners handle COD OTP, cash/UPI, and failed attempts here. Delivery is marked automatically when OTP and
        payment are confirmed. Warehouse only packs and assigns your partner.
      </p>

      {scope ? (
        <p className="mt-4 text-sm">
          {scope.partner ? (
            <>
              Signed in as <span className="font-medium">{scope.partner.name}</span>
              {scope.partner.phone ? ` · ${scope.partner.phone}` : ""}
            </>
          ) : scope.isOpsOverseer ? (
            <span className="text-ink-soft">Ops view — all assigned partner jobs</span>
          ) : (
            <span className="text-rose-800">
              No delivery partner is linked to your login email. Ask admin to set your email on the partner record.
            </span>
          )}
        </p>
      ) : null}

      {error ? <p className="mt-4 text-sm text-rose-800">{error}</p> : null}

      <div className="mt-8 divide-y divide-line border border-line">
        {loading ? <p className="px-4 py-8 text-sm text-ink-soft">Loading jobs…</p> : null}
        {orders.map((order) => (
          <Link
            key={order.id}
            href={`/logistics/dispatch/${encodeURIComponent(order.id)}`}
            className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 text-sm transition hover:bg-paper/50"
          >
            <div>
              <p className="id-mono font-medium">{order.id}</p>
              <p className="mt-1 text-ink-soft">
                {order.address.name} · {order.address.city} {order.address.pincode}
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                {order.status} · {order.deliveryPartner ?? "Unassigned"}
                {isCodPaymentMethod(order.paymentMethod)
                  ? order.codDelivery?.paymentPaid || order.paymentStatus === "Success"
                    ? " · COD paid"
                    : " · COD collect"
                  : " · Prepaid"}
              </p>
            </div>
            <p className="font-medium">{formatINR(order.total)}</p>
          </Link>
        ))}
        {!loading && !orders.length ? (
          <p className="px-4 py-8 text-sm text-ink-soft">
            No jobs assigned to your partner yet. Warehouse must set delivery partner on the order first.
          </p>
        ) : null}
      </div>
    </div>
  );
}
