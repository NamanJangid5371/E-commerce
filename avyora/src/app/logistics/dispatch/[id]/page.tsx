"use client";

import { formatINR } from "@/lib/format";
import {
  fetchDispatchOrder,
  postDispatchAttempt,
  postDispatchCodAction,
} from "@/lib/dispatch-api";
import { DELIVERY_ATTEMPT_REASONS } from "@/lib/logistics-orders";
import { isCodPaymentMethod } from "@/lib/payment-method";
import { useShopStore } from "@/store/shop-store";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

/** 3rd-party partner desk: COD OTP + cash/UPI (auto-delivers) and failed attempts. */
export default function LocalDispatchOrderPage() {
  const { id } = useParams<{ id: string }>();
  const orderId = Array.isArray(id) ? id[0] : id;
  const order = useShopStore((s) => s.orders.find((item) => item.id === orderId));
  const mergeOrders = useShopStore((s) => s.mergeOrders);

  const [loading, setLoading] = useState(!order);
  const [busy, setBusy] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [msg, setMsg] = useState("");
  const [attemptReason, setAttemptReason] =
    useState<(typeof DELIVERY_ATTEMPT_REASONS)[number]>("Customer unavailable");
  const [attemptNote, setAttemptNote] = useState("");

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const res = await fetchDispatchOrder(orderId);
      if (cancelled) return;
      if (res.ok && res.data?.order) mergeOrders([res.data.order]);
      else if (!res.ok) setMsg(res.error || "Could not load job.");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, mergeOrders]);

  if (loading && !order) {
    return <div className="text-sm text-ink-soft">Loading dispatch job…</div>;
  }

  if (!order) {
    return (
      <div>
        Job not found or not assigned to your partner.{" "}
        <Link href="/logistics/dispatch" className="underline">
          Back to local dispatch
        </Link>
      </div>
    );
  }

  async function runCodAction(body: Record<string, unknown>, okMessage: string) {
    setBusy(true);
    setMsg("");
    const res = await postDispatchCodAction(order!.id, body);
    setBusy(false);
    if (!res.ok) {
      setMsg(res.error || "COD action failed.");
      return null;
    }
    if (res.data.order) mergeOrders([res.data.order]);
    else if (res.data.cod) {
      mergeOrders([
        {
          ...order!,
          codDelivery: res.data.cod,
          paymentStatus: res.data.cod.paymentPaid ? "Success" : order!.paymentStatus,
          status: res.data.autoDelivered ? "Delivered" : order!.status,
        },
      ]);
    }
    const deliveredNote = res.data.autoDelivered ? " Order marked Delivered." : "";
    setMsg(`${okMessage}${deliveredNote}`);
    if (res.data.devCode) setMsg(`${okMessage}${deliveredNote} (dev OTP: ${res.data.devCode})`);
    return res.data;
  }

  async function recordAttempt(e: FormEvent) {
    e.preventDefault();
    if (!order) return;
    setBusy(true);
    setMsg("");
    const res = await postDispatchAttempt(order.id, {
      status: "failed",
      reason: attemptReason,
      note: attemptNote.trim() || undefined,
      location: order.address.city,
      setFailedDelivery: true,
    });
    setBusy(false);
    if (!res.ok) {
      setMsg(res.error || "Could not record attempt.");
      return;
    }
    mergeOrders([res.data.order]);
    setAttemptNote("");
    setMsg("Delivery attempt recorded.");
  }

  async function loadRazorpayScript() {
    if (typeof window === "undefined") return false;
    const win = window as Window & {
      Razorpay?: new (opts: Record<string, unknown>) => { open: () => void };
    };
    if (win.Razorpay) return true;
    return new Promise<boolean>((resolve) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  }

  async function startDoorstepUpi() {
    if (!order) return;
    const data = await runCodAction({ action: "upi_order" }, "Doorstep UPI order created.");
    if (!data?.razorpayOrderId || !data.keyId) return;
    const loaded = await loadRazorpayScript();
    const win = window as Window & {
      Razorpay?: new (opts: Record<string, unknown>) => { open: () => void };
    };
    if (!loaded || !win.Razorpay) {
      setMsg("Could not load Razorpay checkout. Retry or mark cash collected instead.");
      return;
    }
    const rzp = new win.Razorpay({
      key: data.keyId,
      amount: data.amount,
      currency: data.currency ?? "INR",
      name: "Avyora COD",
      description: `Doorstep UPI · ${data.orderNumber ?? order.id}`,
      order_id: data.razorpayOrderId,
      handler: (response: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      }) => {
        void runCodAction(
          {
            action: "upi_verify",
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          },
          "Doorstep UPI verified — payment marked paid.",
        );
      },
    });
    rzp.open();
  }

  const cod = order.codDelivery;
  const isCod = isCodPaymentMethod(order.paymentMethod);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-widest text-gold-deep">Local dispatch</p>
        <h1 className="mt-1 text-3xl font-medium tracking-tight">Partner job desk</h1>
        <p className="mt-2 text-sm text-ink-soft">
          <span className="id-mono text-ink">{order.id}</span>
          {order.deliveryPartner ? ` · ${order.deliveryPartner}` : ""}
        </p>
      </div>

      <section className="rounded-3xl border border-line bg-paper/60 p-5 text-sm">
        <p>
          <span className="text-ink">Customer:</span> {order.address.name}
        </p>
        <p className="mt-1">
          <span className="text-ink">Phone:</span> {order.address.phone}
        </p>
        <p className="mt-1">
          <span className="text-ink">Address:</span> {order.address.line1}
          {order.address.line2 ? `, ${order.address.line2}` : ""}, {order.address.city}{" "}
          {order.address.pincode}
        </p>
        <p className="mt-1">
          <span className="text-ink">Collect:</span> {formatINR(order.total)} ·{" "}
          {isCod
            ? cod?.paymentPaid || order.paymentStatus === "Success"
              ? "COD paid"
              : "COD pending"
            : "Prepaid"}
        </p>
        <p className="mt-1">
          <span className="text-ink">Status:</span> {order.status}
        </p>
      </section>

      {isCod ? (
        <section className="rounded-3xl border border-line bg-paper/60 p-5">
          <h2 className="text-lg font-medium">COD verification</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Verify OTP, then collect cash or doorstep UPI. Status moves to Out for Delivery when you
            start verification, and to Delivered automatically once OTP and payment are both confirmed.
          </p>

          <div className="mt-4 grid gap-2 text-sm">
            <p>
              <span className="text-ink">OTP:</span>{" "}
              {cod?.otpVerified
                ? `Verified${cod.otpVerifiedAt ? ` · ${new Date(cod.otpVerifiedAt).toLocaleString("en-IN")}` : ""}`
                : cod?.otpSentAt
                  ? `Sent · expires ${cod.otpExpiresAt ? new Date(cod.otpExpiresAt).toLocaleString("en-IN") : "soon"}`
                  : "Use Resend OTP to start doorstep verification"}
            </p>
            <p>
              <span className="text-ink">Collection:</span>{" "}
              {cod?.collectionMethod === "cash"
                ? `Cash · ${cod.cashCollectedBy ?? "agent"}${
                    cod.cashCollectedAt ? ` · ${new Date(cod.cashCollectedAt).toLocaleString("en-IN")}` : ""
                  }`
                : cod?.collectionMethod === "upi"
                  ? `UPI verified${cod.upiVerifiedAt ? ` · ${new Date(cod.upiVerifiedAt).toLocaleString("en-IN")}` : ""}`
                  : "Not collected"}
            </p>
            {cod?.upiProviderPaymentId ? (
              <p className="id-mono text-xs">UPI txn: {cod.upiProviderPaymentId}</p>
            ) : null}
            {!cod?.canCompleteDelivery && cod?.blockingReason ? (
              <p className="text-rose-800">{cod.blockingReason}</p>
            ) : order.status === "Delivered" ? (
              <p className="text-emerald-800">Delivered — OTP and payment confirmed.</p>
            ) : cod?.canCompleteDelivery ? (
              <p className="text-emerald-800">OTP and payment confirmed — delivering…</p>
            ) : null}
          </div>

          {!cod?.otpVerified && (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="block text-sm">
                Delivery OTP
                <input
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  className="id-mono mt-1 w-40 border border-line bg-transparent px-3 py-2 tracking-[0.2em]"
                />
              </label>
              <button
                type="button"
                disabled={busy || otpCode.length !== 6}
                onClick={() => void runCodAction({ action: "verify_otp", code: otpCode }, "Delivery OTP verified.")}
                className="border border-ink px-4 py-2 text-xs uppercase tracking-widest disabled:opacity-50"
              >
                Verify OTP
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runCodAction({ action: "resend_otp" }, "Delivery OTP resent to customer email.")}
                className="border border-line px-4 py-2 text-xs uppercase tracking-widest disabled:opacity-50"
              >
                Resend OTP
              </button>
            </div>
          )}

          {cod?.otpVerified && !cod.paymentPaid && (
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runCodAction({ action: "collect_cash" }, "COD cash collected — payment marked paid.")
                }
                className="border border-ink px-4 py-2 text-xs uppercase tracking-widest disabled:opacity-50"
              >
                Mark cash collected
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void startDoorstepUpi()}
                className="border border-line px-4 py-2 text-xs uppercase tracking-widest disabled:opacity-50"
              >
                Collect via UPI
              </button>
            </div>
          )}
        </section>
      ) : null}

      <section className="rounded-3xl border border-line bg-paper/60 p-5">
        <h2 className="text-lg font-medium">Delivery attempts</h2>
        <form onSubmit={recordAttempt} className="mt-4 space-y-3">
          <label className="block text-sm">
            Failure reason
            <select
              value={attemptReason}
              onChange={(e) => setAttemptReason(e.target.value as (typeof DELIVERY_ATTEMPT_REASONS)[number])}
              className="mt-1 w-full border border-line bg-transparent px-3 py-2"
            >
              {DELIVERY_ATTEMPT_REASONS.map((reason) => (
                <option key={reason}>{reason}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Note
            <textarea
              value={attemptNote}
              onChange={(e) => setAttemptNote(e.target.value)}
              placeholder="Customer unavailable, address issue…"
              className="mt-1 min-h-20 w-full border border-line bg-transparent px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="border border-line px-4 py-2 text-[11px] uppercase tracking-widest disabled:opacity-50"
          >
            Mark failed attempt
          </button>
        </form>
        <div className="mt-4 space-y-3">
          {(order.deliveryAttempts ?? []).map((attempt) => (
            <div key={attempt.id} className="rounded-2xl border border-line bg-ivory/60 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">Attempt {attempt.attemptNumber}</p>
                <time className="text-xs text-ink-soft">{new Date(attempt.at).toLocaleString("en-IN")}</time>
              </div>
              <p className="mt-1 text-ink-soft">
                {attempt.reason ?? "No reason"}
                {attempt.deliveryPartner ? ` · ${attempt.deliveryPartner}` : ""}
              </p>
              {attempt.note ? <p className="mt-1 text-ink-soft">{attempt.note}</p> : null}
            </div>
          ))}
          {!order.deliveryAttempts?.length ? (
            <p className="text-sm text-ink-soft">No attempts recorded yet.</p>
          ) : null}
        </div>
      </section>

      {msg ? <p className="text-sm text-ink-soft">{msg}</p> : null}

      <p className="text-sm">
        <Link href="/logistics/dispatch" className="underline underline-offset-2">
          All partner jobs
        </Link>
      </p>
    </div>
  );
}
