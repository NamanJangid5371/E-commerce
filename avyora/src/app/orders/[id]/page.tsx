"use client";

import { OrderTrackingCard } from "@/components/order-tracking-card";
import { formatINR } from "@/lib/format";
import { fetchJson, isApiOffline } from "@/lib/api-client";
import { customerCanCancelOrder, customerCancelBlockedReason } from "@/lib/order-cancel";
import { customerCanRequestReturn, customerCanReturnItem, RETURN_WINDOW_DAYS } from "@/lib/order-return";
import {
  createAccountReturn,
  fetchAccountReturns,
  type ReturnDto,
} from "@/lib/returns-api";
import { downloadOrderInvoicePdf, ORDER_FLOW, orderStatusStep } from "@/lib/invoice-pdf";
import { useShopStore } from "@/store/shop-store";
import type { Order } from "@/store/shop-types";
import { ProductImage } from "@/components/product-image";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";

function OrderInner() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const order = useShopStore((s) => s.orders.find((o) => o.id === id));
  const user = useShopStore((s) => s.user);
  const register = useShopStore((s) => s.register);
  const customerCancelOrder = useShopStore((s) => s.customerCancelOrder);
  const mergeOrders = useShopStore((s) => s.mergeOrders);
  const addToCart = useShopStore((s) => s.addToCart);
  const catalog = useShopStore((s) => s.catalog);
  const ops = useShopStore((s) => s.ops);
  const step = order ? orderStatusStep(order.status) : -1;
  const offerAccount = search.get("createAccount") === "1" && user?.role !== "customer";
  const canCancel =
    !!order && user?.role === "customer" && customerCanCancelOrder(order, user.email);
  const cancelBlockedReason =
    !!order && user?.role === "customer" && !canCancel
      ? customerCancelBlockedReason(order)
      : null;

  const [name, setName] = useState(order?.address.name ?? "");
  const [email, setEmail] = useState(order?.customerEmail ?? "");
  const [password, setPassword] = useState("");
  const [accountMsg, setAccountMsg] = useState("");
  const [accountErr, setAccountErr] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelErr, setCancelErr] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [returnItemId, setReturnItemId] = useState("");
  const [returnErr, setReturnErr] = useState("");
  const [returnBusy, setReturnBusy] = useState(false);
  const [orderReturns, setOrderReturns] = useState<ReturnDto[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(!order);
  const shippedAt = order?.trackingEvents?.find((event) => event.status === "Shipped" || event.status === "In Transit")?.at;
  const deliveredAt = order?.trackingEvents?.find((event) => event.status === "Delivered")?.at;
  const canRequestReturn =
    !!order &&
    user?.role === "customer" &&
    customerCanRequestReturn(order, user.email);

  useEffect(() => {
    if (order || !id) {
      setLoadingRemote(false);
      return;
    }
    let cancelled = false;
    setLoadingRemote(true);
    void (async () => {
      const res = await fetchJson<Order>(`/api/account/orders/${encodeURIComponent(id)}`);
      if (cancelled) return;
      if (res.ok && res.data) {
        mergeOrders([res.data]);
      }
      setLoadingRemote(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, order, mergeOrders]);

  useEffect(() => {
    if (!order || user?.role !== "customer") return;
    let cancelled = false;
    const poll = async () => {
      const [returnsRes, orderRes] = await Promise.all([
        fetchAccountReturns(),
        fetchJson<Order>(`/api/account/orders/${encodeURIComponent(order.id)}`),
      ]);
      if (cancelled) return;
      if (returnsRes.ok) {
        setOrderReturns(returnsRes.data.returns.filter((r) => r.orderId === order.id));
      }
      if (orderRes.ok && orderRes.data) {
        mergeOrders([orderRes.data]);
      }
    };
    void poll();
    // Poll faster while a return is open so refund stages appear promptly.
    const t = window.setInterval(() => void poll(), 4000);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [order, user?.role, mergeOrders]);

  if (loadingRemote && !order) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center text-sm text-ink-soft">
        Loading order…
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="font-serif text-4xl tracking-tight">Order not found</h1>
        <p className="mt-3 text-sm text-ink-soft">
          Check your order ID and email on the{" "}
          <Link href="/track" className="underline">
            track order
          </Link>{" "}
          page.
        </p>
        <Link href="/account" className="btn-primary mt-8 inline-flex">
          Back to account
        </Link>
      </div>
    );
  }

  function onCreateAccount(e: FormEvent) {
    e.preventDefault();
    setAccountErr("");
    const err = register(name, email, password);
    if (err) {
      setAccountErr(err);
      return;
    }
    if (order) {
      useShopStore.getState().saveAddress({ ...order.address, isDefault: true });
    }
    setAccountMsg("Account created — you can track this order anytime from Account.");
    router.replace(`/orders/${order!.id}`);
  }

  function reorder() {
    for (const item of order!.items) {
      addToCart(item.productId, item.sku, item.quantity);
    }
    router.push("/cart");
  }

  async function onCancelOrder(e: FormEvent) {
    e.preventDefault();
    if (!order || cancelBusy) return;
    setCancelErr("");
    setCancelBusy(true);

    const res = await fetchJson<Order>(`/api/account/orders/${encodeURIComponent(order.id)}`, {
      method: "POST",
      body: JSON.stringify({ reason: cancelReason }),
    });

    if (res.ok && res.data) {
      mergeOrders([res.data]);
      setCancelBusy(false);
      setCancelOpen(false);
      setCancelReason("");
      return;
    }

    if (!res.ok && !isApiOffline(res)) {
      setCancelErr(res.error || "Could not cancel order.");
      setCancelBusy(false);
      return;
    }

    const err = customerCancelOrder(order.id, cancelReason);
    setCancelBusy(false);
    if (err) {
      setCancelErr(err);
      return;
    }
    setCancelOpen(false);
    setCancelReason("");
  }

  async function onRequestReturn(e: FormEvent) {
    e.preventDefault();
    if (!order || returnBusy) return;
    setReturnErr("");
    const reason = returnReason.trim();
    if (reason.length < 3) {
      setReturnErr("Please share a short reason for the return (at least 3 characters).");
      return;
    }
    const item = order.items.find((i) => (i.orderItemId || i.sku) === returnItemId);
    if (!item?.orderItemId) {
      setReturnErr("Select the product you want to return.");
      return;
    }
    setReturnBusy(true);

    const res = await createAccountReturn({
      orderId: order.id,
      orderItemId: item.orderItemId,
      reason,
    });

    setReturnBusy(false);
    if (!res.ok) {
      setReturnErr(res.error || "Could not submit return request.");
      return;
    }
    setOrderReturns((prev) => [res.data, ...prev.filter((r) => r.id !== res.data.id)]);
    setReturnOpen(false);
    setReturnReason("");
    setReturnItemId("");
  }

  const trackingUrl = order.trackingId
    ? `https://www.google.com/search?q=${encodeURIComponent(order.trackingId + " tracking")}`
    : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <p className="section-kicker">Order</p>
      <h1 className="section-title id-mono text-[clamp(1.35rem,3vw,1.85rem)] font-semibold tracking-normal">
        {order.id}
      </h1>
      <p className="mt-3 text-sm text-ink-soft">
        Placed {new Date(order.createdAt).toLocaleString("en-IN")} · {order.paymentMethod ?? order.paymentId}
        {order.trackingId ? (
          <>
            {" · Tracking "}
            <span className="id-mono">{order.trackingId}</span>
          </>
        ) : null}
      </p>

      {offerAccount && (
        <div className="mt-8 border border-line bg-ivory/80 p-6">
          <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Track this order</p>
          <h2 className="mt-2 font-serif text-2xl tracking-tight">Create a free account</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Optional — save this order to your profile for live tracking, invoices, and faster checkout next time.
          </p>
          <form onSubmit={onCreateAccount} className="mt-5 grid gap-3 sm:grid-cols-2">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className="border border-line bg-transparent px-3 py-2.5 text-sm sm:col-span-2"
            />
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="border border-line bg-transparent px-3 py-2.5 text-sm sm:col-span-2"
            />
            <input
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (8+ chars)"
              className="border border-line bg-transparent px-3 py-2.5 text-sm sm:col-span-2"
            />
            {accountErr && <p className="text-sm text-red-800 sm:col-span-2">{accountErr}</p>}
            {accountMsg && <p className="text-sm text-ink-soft sm:col-span-2">{accountMsg}</p>}
            <button type="submit" className="btn-primary sm:col-span-2 sm:w-fit">
              Create account & track
            </button>
          </form>
        </div>
      )}

      <div className="mt-8 border border-line bg-ivory/70 p-5">
        <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Live tracking</p>
        <p className="mt-2 font-serif text-3xl">{order.status}</p>
        {step >= 0 && (
          <div className="mt-5 flex flex-wrap gap-1">
            {ORDER_FLOW.map((s, i) => (
              <span
                key={s}
                className={`rounded-lg px-2.5 py-1.5 text-[10px] tracking-[0.12em] uppercase ${
                  i <= step ? "bg-ink text-ivory" : "border border-line text-ink-soft"
                }`}
              >
                {s}
              </span>
            ))}
          </div>
        )}
        {order.paymentStatus && (
          <p className="mt-4 text-sm text-ink-soft">
            Payment:{" "}
            {order.codDelivery?.paymentPaid || order.paymentStatus === "Success"
              ? "Paid"
              : order.paymentStatus}
            {order.paymentMethod ? ` · ${order.paymentMethod}` : ""}
            {order.codDelivery?.collectionMethod
              ? ` · ${order.codDelivery.collectionMethod === "cash" ? "Cash collected" : "UPI verified"}`
              : ""}
          </p>
        )}
        {order.codDelivery && (
          <div className="mt-3 space-y-1 text-sm text-ink-soft">
            <p>
              Delivery verification:{" "}
              {order.codDelivery.otpVerified
                ? "OTP confirmed with courier"
                : order.codDelivery.otpSentAt
                  ? "OTP sent to your email — share only with the courier"
                  : "OTP will be emailed when the order is out for delivery"}
            </p>
            {order.codDelivery.upiProviderPaymentId ? (
              <p className="id-mono text-xs">UPI ref: {order.codDelivery.upiProviderPaymentId}</p>
            ) : null}
          </div>
        )}
        {order.shippingMethodName && (
          <p className="mt-1 text-sm text-ink-soft">Shipping: {order.shippingMethodName}</p>
        )}
        {(order.deliveryPartner || order.estimatedShippingDate || order.estimatedDeliveryDate || shippedAt || deliveredAt) && (
          <div className="mt-1 space-y-1 text-sm text-ink-soft">
            <p>
              {order.deliveryPartner ? `Partner: ${order.deliveryPartner}` : "Partner pending"}
              {order.estimatedShippingDate
                ? ` · Ship by ${new Date(order.estimatedShippingDate).toLocaleDateString("en-IN")}`
                : ""}
              {order.estimatedDeliveryDate
                ? ` · ETA ${new Date(order.estimatedDeliveryDate).toLocaleDateString("en-IN")}`
                : ""}
            </p>
            {(shippedAt || deliveredAt) && (
              <p>
                {shippedAt ? `Shipped on ${new Date(shippedAt).toLocaleDateString("en-IN")}` : "Shipment date pending"}
                {deliveredAt ? ` · Delivered on ${new Date(deliveredAt).toLocaleDateString("en-IN")}` : ""}
              </p>
            )}
          </div>
        )}
        {order.giftWrap && (
          <p className="mt-1 text-sm text-ink-soft">
            Gift wrap{order.giftMessage ? ` — “${order.giftMessage}”` : ""}
          </p>
        )}
        {trackingUrl && (
          <a href={trackingUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm underline">
            Open carrier tracking for {order.trackingId}
          </a>
        )}
      </div>

      <div className="mt-8">
        <OrderTrackingCard order={order} returns={orderReturns} variant="plain" />
      </div>

      <div className="mt-10 space-y-4">
        {order.items.map((item) => (
          <div key={item.sku} className="flex gap-4 border-b border-line pb-4">
            <div className="relative h-20 w-16 overflow-hidden bg-ivory ring-1 ring-[rgba(138,109,69,0.18)]">
              <ProductImage src={item.image} alt={item.name} fill />
            </div>
            <div className="flex-1">
              <p className="text-base font-medium">{item.name}</p>
              <p className="text-sm text-ink-soft">
                {item.sku} · ×{item.quantity}
              </p>
            </div>
            <p className="price-amount text-xl">{formatINR(item.price * item.quantity)}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 space-y-2 border border-line bg-paper/50 p-5 text-sm">
        <p className="flex justify-between">
          <span className="text-ink-soft">Subtotal</span>
          <span>{formatINR(order.subtotal)}</span>
        </p>
        <p className="flex justify-between">
          <span className="text-ink-soft">Discount</span>
          <span>{formatINR(order.discount)}</span>
        </p>
        <p className="flex justify-between">
          <span className="text-ink-soft">Shipping</span>
          <span>{order.shipping ? formatINR(order.shipping) : "Complimentary"}</span>
        </p>
        <p className="flex justify-between border-t border-line pt-3 text-base font-medium">
          <span>Total</span>
          <span className="price-amount text-2xl">{formatINR(order.total)}</span>
        </p>
        <p className="pt-2 text-ink-soft">
          Ship to {order.address.name}, {order.address.line1}, {order.address.city} {order.address.pincode} ·{" "}
          {order.address.phone}
        </p>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() =>
            downloadOrderInvoicePdf(order, {
              customerName: user?.name,
              catalog,
              store: ops?.settings,
            })
          }
          className="btn-primary"
        >
          Download invoice PDF
        </button>
        <button
          type="button"
          onClick={reorder}
          className="border border-ink px-5 py-3 text-[11px] tracking-[0.2em] uppercase"
        >
          Buy again
        </button>
        {canCancel && (
          <button
            type="button"
            onClick={() => {
              setCancelErr("");
              setCancelOpen((open) => !open);
            }}
            className="border border-line px-5 py-3 text-[11px] tracking-[0.2em] uppercase text-red-900 transition hover:border-red-900"
          >
            Cancel order
          </button>
        )}
        <Link
          href="/account?section=orders"
          className="border border-line px-5 py-3 text-[11px] tracking-[0.2em] uppercase transition hover:border-ink"
        >
          All orders
        </Link>
      </div>
      {cancelBlockedReason &&
      order.status !== "Cancelled" &&
      order.status !== "Refunded" &&
      order.status !== "Returned" ? (
        <p className="mt-3 text-sm text-ink-soft">{cancelBlockedReason}</p>
      ) : null}

      {cancelOpen && canCancel && (
        <form onSubmit={onCancelOrder} className="mt-6 border border-line bg-ivory/70 p-5">
          <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Cancel order</p>
          <p className="mt-2 text-sm text-ink-soft">
            You can cancel while the order is still being prepared (before it ships). Stock is released back to the atelier.
          </p>
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={3}
            maxLength={200}
            placeholder="Optional reason (changed mind, wrong size, …)"
            className="mt-4 w-full border border-line bg-transparent px-3 py-2.5 text-sm"
          />
          {cancelErr && <p className="mt-2 text-sm text-red-800">{cancelErr}</p>}
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="submit" disabled={cancelBusy} className="btn-primary disabled:opacity-50">
              {cancelBusy ? "Cancelling…" : "Confirm cancellation"}
            </button>
            <button
              type="button"
              onClick={() => setCancelOpen(false)}
              className="border border-line px-5 py-3 text-[11px] tracking-[0.2em] uppercase"
            >
              Keep order
            </button>
          </div>
        </form>
      )}

      {order.status === "Cancelled" && (
        <p className="mt-6 text-sm text-ink-soft">
          This order was cancelled
          {order.cancelReason ? ` — ${order.cancelReason}` : ""}.
        </p>
      )}

      {canRequestReturn && !returnOpen && (
        <button
          type="button"
          onClick={() => {
            const first = order.items.find((i) => customerCanReturnItem(order, i, user?.email));
            setReturnItemId(first?.orderItemId || first?.sku || "");
            setReturnOpen(true);
          }}
          className="mt-6 text-[11px] tracking-widest uppercase underline"
        >
          Request return
        </button>
      )}

      {returnOpen && canRequestReturn && (
        <form onSubmit={onRequestReturn} className="mt-6 border border-line bg-ivory/70 p-5">
          <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Request return</p>
          <p className="mt-2 text-sm text-ink-soft">
            Returns are accepted within {RETURN_WINDOW_DAYS} days of delivery for each product. Select the
            item to return — refunds are issued by our team after warehouse inspection.
          </p>
          <fieldset className="mt-4 space-y-2">
            {order.items.map((item) => {
              const eligible = customerCanReturnItem(order, item, user?.email);
              const value = item.orderItemId || item.sku;
              return (
                <label
                  key={value}
                  className={`flex cursor-pointer items-start justify-between gap-3 border border-line px-3 py-2 text-sm ${
                    !eligible ? "opacity-50" : ""
                  }`}
                >
                  <span className="flex gap-2">
                    <input
                      type="radio"
                      name="returnItem"
                      value={value}
                      disabled={!eligible}
                      checked={returnItemId === value}
                      onChange={() => setReturnItemId(value)}
                    />
                    <span>
                      {item.name} · Qty {item.quantity}
                      {!eligible && (
                        <span className="block text-xs text-ink-soft">Not eligible for return</span>
                      )}
                    </span>
                  </span>
                  <span className="text-ink-soft">{formatINR(item.price * item.quantity)}</span>
                </label>
              );
            })}
          </fieldset>
          <textarea
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            rows={3}
            maxLength={500}
            required
            placeholder="Reason (wrong size, damaged, changed mind…)"
            className="mt-4 w-full border border-line bg-transparent px-3 py-2.5 text-sm"
          />
          {returnErr && <p className="mt-2 text-sm text-red-800">{returnErr}</p>}
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="submit" disabled={returnBusy} className="btn-primary disabled:opacity-50">
              {returnBusy ? "Submitting…" : "Submit return request"}
            </button>
            <button
              type="button"
              onClick={() => {
                setReturnOpen(false);
                setReturnErr("");
              }}
              className="border border-line px-5 py-3 text-[11px] tracking-[0.2em] uppercase"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <Link href="/shop" className="mt-10 block text-[11px] tracking-[0.2em] uppercase text-ink-soft transition hover:text-ink">
        Continue shopping
      </Link>
    </div>
  );
}

export default function OrderPage() {
  return (
    <Suspense fallback={<div className="px-4 py-16 text-sm text-ink-soft">Loading order…</div>}>
      <OrderInner />
    </Suspense>
  );
}
