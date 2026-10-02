"use client";

import { formatINR } from "@/lib/format";
import { fetchLogisticsOrders, patchLogisticsOrderApi } from "@/lib/logistics-api";
import { nextPackStep, readyToPack, statusBadgeClass } from "@/lib/logistics-orders";
import { isCodPaymentMethod } from "@/lib/payment-method";
import { useShopStore } from "@/store/shop-store";
import type { Order } from "@/store/shop-types";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export default function LogisticsPackPage() {
  const orders = useShopStore((s) => s.orders);
  const mergeOrders = useShopStore((s) => s.mergeOrders);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

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

  const queue = useMemo(
    () =>
      orders
        .filter(readyToPack)
        .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
    [orders],
  );

  async function advance(order: Order) {
    const step = nextPackStep(order);
    if (!step) return;
    setBusyId(order.id);
    setMsg("");
    const res = await patchLogisticsOrderApi(order.id, {
      status: step.status,
      note: step.status === "Packed" ? "Packed at the logistics desk." : "Packing started.",
    });
    setBusyId(null);
    if (!res.ok) {
      setMsg(res.error || `Could not move ${order.id}.`);
      return;
    }
    mergeOrders([res.data]);
    setMsg(`${order.id} is now ${step.status}.`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">Packing desk</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Oldest confirmed orders first. Check the piece, hallmark, and gift note, then mark it packed.
          </p>
        </div>
        <p className="text-sm text-ink-soft">{loading ? "Loading…" : `${queue.length} to pack`}</p>
      </div>

      {msg && <p className="text-sm text-ink-soft">{msg}</p>}

      {!loading && queue.length === 0 && (
        <p className="rounded-3xl border border-line bg-paper/60 px-5 py-10 text-sm text-ink-soft">
          Nothing is waiting to be packed. Unpaid orders stay out of this desk until payment is confirmed.
        </p>
      )}

      <div className="space-y-4">
        {queue.map((order) => {
          const step = nextPackStep(order);
          return (
            <article key={order.id} className="rounded-3xl border border-line bg-paper/70 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{order.id}</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {order.address.name} · {order.address.city} {order.address.pincode} · {order.address.phone}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusBadgeClass(order.status)}`}>
                  {order.status}
                </span>
              </div>

              <ul className="mt-4 divide-y divide-line border-y border-line">
                {order.items.map((item) => (
                  <li key={`${order.id}-${item.sku}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>
                      {item.name}
                      <span className="mt-0.5 block text-xs text-ink-soft">{item.sku}</span>
                    </span>
                    <span className="text-ink-soft">× {item.quantity}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
                <span>{formatINR(order.total)}</span>
                <span>{isCodPaymentMethod(order.paymentMethod) ? "COD" : order.paymentMethod ?? "Prepaid"}</span>
                {order.giftWrap ? <span>Gift wrap</span> : null}
                {order.giftMessage ? <span>Note: {order.giftMessage}</span> : null}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                {step ? (
                  <button
                    type="button"
                    disabled={busyId === order.id}
                    onClick={() => void advance(order)}
                    className="btn-primary min-h-11 w-full disabled:opacity-40 sm:w-auto"
                  >
                    {busyId === order.id ? "Saving…" : step.label}
                  </button>
                ) : null}
                <Link
                  href={`/logistics/orders/${order.id}#shipping-label`}
                  className="inline-flex min-h-11 items-center justify-center border border-line px-3 py-2 text-[11px] uppercase tracking-widest"
                >
                  Label
                </Link>
                <Link
                  href={`/logistics/orders/${order.id}`}
                  className="inline-flex min-h-11 items-center justify-center border border-line px-3 py-2 text-[11px] uppercase tracking-widest"
                >
                  Open
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
