"use client";

import { OrderTrackingCard } from "@/components/order-tracking-card";
import { formatINR } from "@/lib/format";
import { downloadOrderInvoicePdf } from "@/lib/invoice-pdf";
import { fetchAdminReturns, type ReturnDto } from "@/lib/returns-api";
import { useShopStore } from "@/store/shop-store";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function AdminOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const order = useShopStore((s) => s.orders.find((o) => o.id === id));
  const updateOrder = useShopStore((s) => s.updateOrder);
  const cancelOrder = useShopStore((s) => s.cancelOrder);
  const catalog = useShopStore((s) => s.catalog);
  const ops = useShopStore((s) => s.ops);
  const [returns, setReturns] = useState<ReturnDto[]>([]);

  useEffect(() => {
    if (!id) return;
    const orderId = Array.isArray(id) ? id[0] : id;
    let cancelled = false;
    void (async () => {
      const res = await fetchAdminReturns({ orderId, page: 1 });
      if (cancelled || !res.ok) return;
      setReturns(res.data.returns ?? []);
    })();
    const t = window.setInterval(() => {
      void (async () => {
        const res = await fetchAdminReturns({ orderId, page: 1 });
        if (cancelled || !res.ok) return;
        setReturns(res.data.returns ?? []);
      })();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [id]);

  if (!order) {
    return (
      <div>
        Order not found.{" "}
        <Link href="/admin/orders" className="underline">
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <p className="text-xs uppercase tracking-widest text-gold-deep">Order</p>
      <h1 className="mt-1 text-3xl font-medium tracking-tight">{order.id}</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Payment {order.paymentId} · {order.paymentMethod ?? "Razorpay"} ·{" "}
        {order.codDelivery?.paymentPaid || order.paymentStatus === "Success"
          ? "Paid"
          : order.paymentStatus ?? "Pending"}{" "}
        · {order.customerEmail ?? "guest"}
        {order.codDelivery?.collectionMethod
          ? ` · COD ${order.codDelivery.collectionMethod === "cash" ? "cash" : "UPI"}`
          : ""}
      </p>
      <Link href={`/orders/${order.id}`} target="_blank" className="mt-2 inline-block text-xs uppercase tracking-widest underline">
        View customer tracking page
      </Link>

      {order.codDelivery ? (
        <div className="mt-6 border border-line bg-paper/50 p-5 text-sm">
          <p className="text-xs uppercase tracking-widest text-gold-deep">COD delivery verification</p>
          <div className="mt-3 grid gap-2 text-ink-soft md:grid-cols-2">
            <p>
              <span className="text-ink">OTP:</span>{" "}
              {order.codDelivery.otpVerified
                ? `Verified${order.codDelivery.otpVerifiedAt ? ` · ${new Date(order.codDelivery.otpVerifiedAt).toLocaleString("en-IN")}` : ""}`
                : order.codDelivery.otpSentAt
                  ? `Sent${order.codDelivery.otpExpiresAt ? ` · expires ${new Date(order.codDelivery.otpExpiresAt).toLocaleString("en-IN")}` : ""}`
                  : "Not issued"}
            </p>
            <p>
              <span className="text-ink">Collection:</span>{" "}
              {order.codDelivery.collectionMethod === "cash"
                ? `Cash${order.codDelivery.cashCollectedAt ? ` · ${new Date(order.codDelivery.cashCollectedAt).toLocaleString("en-IN")}` : ""}`
                : order.codDelivery.collectionMethod === "upi"
                  ? `UPI${order.codDelivery.upiVerifiedAt ? ` · ${new Date(order.codDelivery.upiVerifiedAt).toLocaleString("en-IN")}` : ""}`
                  : "Pending"}
            </p>
            {order.codDelivery.upiProviderPaymentId ? (
              <p className="id-mono md:col-span-2">
                <span className="text-ink">UPI txn:</span> {order.codDelivery.upiProviderPaymentId}
              </p>
            ) : null}
            <p className="md:col-span-2">
              <span className="text-ink">Delivery ready:</span>{" "}
              {order.codDelivery.canCompleteDelivery
                ? "Yes — OTP + payment verified"
                : order.codDelivery.blockingReason ?? "Requirements outstanding"}
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-8 space-y-3 text-sm">
        {order.items.map((item) => (
          <div key={item.sku} className="flex justify-between border-b border-line pb-3">
            <span>
              {item.name} · {item.sku} ×{item.quantity}
            </span>
            <span>{formatINR(item.price * item.quantity)}</span>
          </div>
        ))}
        <p className="flex justify-between">
          <span>Total</span>
          <span>{formatINR(order.total)}</span>
        </p>
        {order.refundedAmount ? (
          <p className="text-ink-soft">Refunded {formatINR(order.refundedAmount)}</p>
        ) : null}
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="text-sm">
          <p className="text-ink-soft">Fulfilment status</p>
          <p className="mt-1 font-medium">{order.status}</p>
          <span className="mt-1 block text-xs text-ink-soft">
            Shipment and COD fulfilment updates are managed only from the logistics portal.
          </span>
        </div>
        <div className="text-sm">
          <p className="text-ink-soft">Tracking ID</p>
          <p className="mt-1 font-medium">{order.trackingId ?? "Pending"}</p>
        </div>
        <div className="text-sm">
          <p className="text-ink-soft">Delivery partner</p>
          <p className="mt-1 font-medium">{order.deliveryPartner ?? "Partner pending"}</p>
        </div>
        <div className="text-sm">
          <p className="text-ink-soft">Estimated shipping</p>
          <p className="mt-1 font-medium">
            {order.estimatedShippingDate ? new Date(order.estimatedShippingDate).toLocaleDateString("en-IN") : "Not set"}
          </p>
        </div>
        <div className="text-sm">
          <p className="text-ink-soft">Estimated delivery</p>
          <p className="mt-1 font-medium">
            {order.estimatedDeliveryDate ? new Date(order.estimatedDeliveryDate).toLocaleDateString("en-IN") : "Not set"}
          </p>
        </div>
      </div>

      <div className="mt-8">
        <OrderTrackingCard
          order={order}
          returns={returns}
          variant="plain"
          returnHref={(ret) => `/admin/returns/${ret.id}`}
        />
      </div>

      <div className="mt-8 border border-line bg-paper/50 p-5">
        <p className="text-xs uppercase tracking-widest text-gold-deep">Shipment details</p>
        <div className="mt-4 grid gap-2 text-sm text-ink-soft md:grid-cols-2">
          <p><span className="text-ink">Tracking number:</span> {order.trackingId ?? "Pending"}</p>
          <p><span className="text-ink">Delivery partner:</span> {order.deliveryPartner ?? "Partner pending"}</p>
          <p><span className="text-ink">ETA:</span> {order.estimatedDeliveryDate ? new Date(order.estimatedDeliveryDate).toLocaleDateString("en-IN") : "Not set"}</p>
          <p><span className="text-ink">Updated by:</span> {order.lastUpdatedBy ?? "System"}</p>
        </div>
        {!!order.deliveryAttempts?.length && (
          <div className="mt-5 space-y-3">
            {order.deliveryAttempts.map((attempt) => (
              <div key={attempt.id} className="rounded-2xl border border-line/80 bg-paper/40 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">Attempt {attempt.attemptNumber}</p>
                  <time className="text-xs text-ink-soft">{new Date(attempt.at).toLocaleString("en-IN")}</time>
                </div>
                <p className="mt-1 text-ink-soft">{attempt.reason ?? "No reason"}{attempt.deliveryPartner ? ` · ${attempt.deliveryPartner}` : ""}</p>
                {attempt.note && <p className="mt-1 text-ink-soft">{attempt.note}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-8 border border-line p-5">
        <p className="text-xs uppercase tracking-widest text-gold-deep">Shipment control</p>
        <p className="mt-2 text-sm text-ink-soft">
          Admin can view shipment progress here, but only logistics can update shipment status, tracking, partner, and ETA. COD doorstep OTP/cash/UPI is handled on the delivery partner desk.
        </p>
      </div>

      <label className="mt-4 block text-sm">
        Internal notes
        <textarea
          value={order.notes ?? ""}
          onChange={(e) => updateOrder(order.id, { notes: e.target.value })}
          className="mt-1 min-h-24 w-full border border-line bg-transparent px-3 py-2"
        />
      </label>
      <p className="mt-6 text-sm">
        Ship to {order.address.name}, {order.address.line1}, {order.address.city} {order.address.pincode} ·{" "}
        {order.address.phone}
      </p>
      <button
        type="button"
        onClick={() =>
          downloadOrderInvoicePdf(order, {
            customerName: order.address.name,
            catalog,
            store: ops?.settings,
          })
        }
        className="mt-4 text-xs uppercase tracking-widest underline"
      >
        Download invoice PDF
      </button>
      {order.status !== "Refunded" && order.status !== "Cancelled" && (
        <div className="mt-8 space-y-3">
          <div className="flex flex-wrap gap-3">
            {returns.some((r) => r.status === "REFUND_ELIGIBLE") ? (
              returns
                .filter((r) => r.status === "REFUND_ELIGIBLE")
                .map((r) => (
                  <Link
                    key={r.id}
                    href={`/admin/returns/${r.id}`}
                    className="border border-ink px-5 py-2 text-xs uppercase tracking-widest"
                  >
                    Issue refund · {r.returnNumber}
                  </Link>
                ))
            ) : (
              <p className="text-sm text-ink-soft">
                Refunds require an approved return that logistics has received and inspected.{" "}
                <Link href="/admin/returns" className="underline">
                  Open returns
                </Link>
              </p>
            )}
            <button
              type="button"
              onClick={() => cancelOrder(order.id, "Cancelled by admin")}
              className="border border-line px-5 py-2 text-xs uppercase tracking-widest"
            >
              Cancel order
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
