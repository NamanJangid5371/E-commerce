"use client";

import { OrderTrackingTimeline } from "@/components/order-tracking-timeline";
import { formatINR } from "@/lib/format";
import { fetchJson } from "@/lib/api-client";
import { ORDER_FLOW, orderStatusStep } from "@/lib/invoice-pdf";
import { useShopStore } from "@/store/shop-store";
import type { Order } from "@/store/shop-types";
import Link from "next/link";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function TrackInner() {
  const mergeOrders = useShopStore((s) => s.mergeOrders);
  const searchParams = useSearchParams();
  const [orderId, setOrderId] = useState("");
  const [email, setEmail] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fromQr = searchParams.get("order")?.trim();
    if (fromQr) setOrderId(fromQr);
  }, [searchParams]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    setOrder(null);

    const res = await fetchJson<Order>("/api/orders/track", {
      method: "POST",
      body: JSON.stringify({
        orderId: orderId.trim(),
        email: email.trim().toLowerCase(),
      }),
    });

    if (res.ok && res.data) {
      mergeOrders([res.data]);
      setOrder(res.data);
      setBusy(false);
      return;
    }

    // Fallback: local Zustand order (recent checkout on this device).
    const local = useShopStore.getState().orders.find(
      (o) =>
        o.id.toLowerCase() === orderId.trim().toLowerCase() &&
        o.customerEmail?.toLowerCase() === email.trim().toLowerCase(),
    );
    if (local) {
      setOrder(local);
      setBusy(false);
      return;
    }

    setError(
      (!res.ok ? res.error : undefined) ||
        "No order found with that ID and email. Check your confirmation email and try again.",
    );
    setBusy(false);
  }

  const step = order ? orderStatusStep(order.status) : -1;
  const shippedAt = order?.trackingEvents?.find((event) => event.status === "Shipped" || event.status === "In Transit")?.at;
  const deliveredAt = order?.trackingEvents?.find((event) => event.status === "Delivered")?.at;

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <p className="section-kicker">Track order</p>
      <h1 className="section-title">Where is my piece?</h1>
      <p className="mt-3 text-sm text-ink-soft">
        Enter your order ID and the email used at checkout. Signed-in customers can also track from{" "}
        <Link href="/account?section=orders" className="underline">
          Account → Orders
        </Link>
        .
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4 border border-line bg-ivory/70 p-6">
        <label className="block text-sm">
          Order ID
          <input
            required
            value={orderId}
            onChange={(e) => {
              setOrder(null);
              setOrderId(e.target.value);
            }}
            placeholder="e.g. AVY-…"
            className="mt-1 w-full border border-line bg-transparent px-3 py-2.5"
          />
        </label>
        <label className="block text-sm">
          Email
          <input
            required
            type="email"
            value={email}
            onChange={(e) => {
              setOrder(null);
              setEmail(e.target.value);
            }}
            placeholder="you@example.com"
            className="mt-1 w-full border border-line bg-transparent px-3 py-2.5"
          />
        </label>
        {error && <p className="text-sm text-red-800">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "Looking up…" : "Track shipment"}
        </button>
      </form>

      {order && (
        <div className="mt-10 space-y-6">
          <div className="border border-line bg-paper/40 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Order</p>
                <h2 className="id-mono text-xl font-semibold tracking-normal md:text-2xl">{order.id}</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  Placed {new Date(order.createdAt).toLocaleString("en-IN")} · {formatINR(order.total)}
                </p>
              </div>
              <p className="font-serif text-xl">{order.status}</p>
            </div>
            {step >= 0 && (
              <div className="mt-5 flex flex-wrap gap-1">
                {ORDER_FLOW.map((s, i) => (
                  <span
                    key={s}
                    className={`rounded-lg px-2 py-1 text-[10px] tracking-[0.12em] uppercase ${
                      i <= step ? "bg-ink text-ivory" : "border border-line text-ink-soft"
                    }`}
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
            {(order.trackingId || order.deliveryPartner || order.estimatedShippingDate || order.estimatedDeliveryDate || shippedAt || deliveredAt) && (
              <div className="mt-4 space-y-1 text-sm text-ink-soft">
                <p>
                  {order.trackingId ? (
                    <>
                      Courier tracking ID: <span className="id-mono">{order.trackingId}</span>
                    </>
                  ) : (
                    "Courier tracking ID pending"
                  )}
                  {order.deliveryPartner ? ` · ${order.deliveryPartner}` : ""}
                </p>
                {order.estimatedShippingDate && <p>Estimated ship date: {order.estimatedShippingDate}</p>}
                {order.estimatedDeliveryDate && <p>Estimated delivery: {order.estimatedDeliveryDate}</p>}
                {shippedAt && <p>Shipped: {new Date(shippedAt).toLocaleString("en-IN")}</p>}
                {deliveredAt && <p>Delivered: {new Date(deliveredAt).toLocaleString("en-IN")}</p>}
              </div>
            )}
          </div>

          <OrderTrackingTimeline order={order} />

          <div className="border border-line bg-ivory/60 p-5 text-sm">
            <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Items</p>
            <ul className="mt-3 space-y-2">
              {order.items.map((item) => (
                <li key={`${item.sku}-${item.productId}`} className="flex justify-between gap-3">
                  <span>
                    {item.name} ×{item.quantity}
                  </span>
                  <span>{formatINR(item.price * item.quantity)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TrackPage() {
  return (
    <Suspense fallback={<div className="px-4 py-16 text-sm text-ink-soft">Loading…</div>}>
      <TrackInner />
    </Suspense>
  );
}
