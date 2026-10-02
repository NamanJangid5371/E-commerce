"use client";

import { ReturnTrackingTimeline } from "@/components/return-tracking-timeline";
import { formatINR } from "@/lib/format";
import {
  adminReturnNextStep,
  fetchAdminReturn,
  postAdminReturnAction,
  type ReturnDto,
} from "@/lib/returns-api";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function AdminReturnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [ret, setRet] = useState<ReturnDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    const res = await fetchAdminReturn(Array.isArray(id) ? id[0] : id);
    if (res.ok) setRet(res.data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 3000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  async function act(body: Record<string, unknown>) {
    if (!ret) return;
    setBusy(true);
    setMsg("");
    const res = await postAdminReturnAction(ret.id, body);
    setBusy(false);
    if (!res.ok) {
      setMsg(res.error || "Action failed.");
      return;
    }
    setRet(res.data);
    setNote("");
    setMsg("Updated.");
  }

  if (loading) return <p className="text-sm text-ink-soft">Loading return…</p>;
  if (!ret) {
    return (
      <div>
        Return not found.{" "}
        <Link href="/admin/returns" className="underline">
          Back
        </Link>
      </div>
    );
  }

  const canRefund = ret.status === "REFUND_ELIGIBLE";
  const productReturned = Boolean(ret.warehouseReceivedAt || ret.productVerified);
  const next = adminReturnNextStep(ret);
  const inspectionDone =
    Boolean(ret.inspectionAt) ||
    ret.status === "INSPECTION_APPROVED" ||
    ret.status === "REFUND_ELIGIBLE" ||
    ret.status === "REFUND_INITIATED" ||
    ret.status === "REFUND_COMPLETED";

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/returns" className="text-sm underline">
          ← Returns
        </Link>
        <h1 className="mt-2 text-3xl font-medium tracking-tight">{ret.returnNumber}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {ret.statusLabel} · Order{" "}
          <Link href={`/admin/orders/${ret.orderId}`} className="underline">
            {ret.orderId}
          </Link>
        </p>
      </div>

      {msg && <p className="text-sm text-ink-soft">{msg}</p>}

      {next && (
        <div className="border border-line bg-ivory/80 px-4 py-3 text-sm">
          <p className="font-medium">Logistics update</p>
          <p className="mt-1 text-ink-soft">
            Product returned to warehouse: <span className="text-ink">{productReturned ? "Yes" : "No"}</span>
            {" · "}
            Inspection: <span className="text-ink">{inspectionDone ? "Approved" : "Pending"}</span>
          </p>
          <p className="mt-1">Next admin step: {next}</p>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <section className="border border-line p-5">
            <h2 className="text-lg font-medium">Product</h2>
            <p className="mt-3 font-medium">{ret.item.name}</p>
            <p className="text-sm text-ink-soft">
              {ret.item.sku} · Qty {ret.quantity} · {formatINR(ret.estimatedRefundAmount)}
            </p>
            <p className="mt-2 text-sm text-ink-soft">
              Delivered:{" "}
              {ret.item.deliveredAt
                ? new Date(ret.item.deliveredAt).toLocaleString("en-IN")
                : "—"}
            </p>
            <p className="mt-3 text-sm">Reason: {ret.reason}</p>
            {ret.description && <p className="mt-1 text-sm text-ink-soft">{ret.description}</p>}
          </section>

          <section className="border border-line p-5">
            <h2 className="text-lg font-medium">Customer</h2>
            <p className="mt-3 text-sm">{ret.customerName ?? "—"}</p>
            <p className="text-sm text-ink-soft">{ret.customerEmail ?? "—"}</p>
          </section>

          <section className="border border-line p-5">
            <h2 className="text-lg font-medium">Warehouse & inspection</h2>
            <ul className="mt-3 space-y-1 text-sm">
              <li>
                Warehouse received:{" "}
                <span className="font-medium">{productReturned ? "YES" : "NO"}</span>
                {ret.warehouseReceivedAt
                  ? ` · ${new Date(ret.warehouseReceivedAt).toLocaleString("en-IN")}`
                  : ""}
              </li>
              <li>
                Correct product verified:{" "}
                <span className="font-medium">{ret.productVerified ? "YES" : "NO"}</span>
                {ret.productVerifiedBy ? ` · ${ret.productVerifiedBy}` : ""}
              </li>
              <li>
                Inspection:{" "}
                <span className="font-medium">
                  {ret.status === "INSPECTION_REJECTED"
                    ? "REJECTED"
                    : inspectionDone
                      ? "APPROVED"
                      : productReturned
                        ? "PENDING (logistics)"
                        : "NOT STARTED"}
                </span>
                {ret.inspectionAt ? ` · ${new Date(ret.inspectionAt).toLocaleString("en-IN")}` : ""}
              </li>
              <li>
                Refund eligible:{" "}
                <span className="font-medium">
                  {ret.status === "REFUND_ELIGIBLE" ||
                  ret.status === "REFUND_INITIATED" ||
                  ret.status === "REFUND_COMPLETED"
                    ? "YES"
                    : "NO"}
                </span>
              </li>
            </ul>
            {ret.refund && (
              <p className="mt-3 text-sm">
                Refund {ret.refund.status}: {formatINR(ret.refund.amount)}
                {ret.refund.providerRefundId ? ` · ${ret.refund.providerRefundId}` : ""}
              </p>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="border border-line p-5">
            <h2 className="text-lg font-medium">Return progress</h2>
            <div className="mt-4">
              <ReturnTrackingTimeline ret={ret} />
            </div>
          </section>

          <section className="border border-line p-5">
            <h2 className="text-lg font-medium">Actions</h2>
            <label className="mt-3 block text-sm">
              Note
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="mt-1 w-full border border-line bg-transparent px-3 py-2"
              />
            </label>
            <p className="mt-2 text-xs text-ink-soft">
              Admin: approve return → mark refund eligible → generate refund. Pickup, warehouse, and
              inspection are updated by logistics and appear above automatically.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {ret.status === "RETURN_REQUESTED" && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act({ action: "approve", note })}
                    className="border border-ink bg-ink px-3 py-2 text-[11px] uppercase tracking-widest text-paper disabled:opacity-50"
                  >
                    Approve return
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act({ action: "reject", note: note || "Rejected by admin" })}
                    className="border border-line px-3 py-2 text-[11px] uppercase tracking-widest disabled:opacity-50"
                  >
                    Reject
                  </button>
                </>
              )}
              {ret.status === "INSPECTION_APPROVED" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ action: "mark_refund_eligible", note })}
                  className="border border-ink bg-ink px-3 py-2 text-[11px] uppercase tracking-widest text-paper disabled:opacity-50"
                >
                  Mark refund eligible
                </button>
              )}
              {canRefund && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Initiate refund of ${formatINR(ret.estimatedRefundAmount)}?`,
                      )
                    ) {
                      return;
                    }
                    void act({
                      action: "refund",
                      amount: ret.estimatedRefundAmount,
                      reason: note || ret.reason,
                    });
                  }}
                  className="border border-ink bg-ink px-3 py-2 text-[11px] uppercase tracking-widest text-paper disabled:opacity-50"
                >
                  Generate refund ({formatINR(ret.estimatedRefundAmount)})
                </button>
              )}
              {ret.status !== "RETURN_REQUESTED" &&
                ret.status !== "INSPECTION_APPROVED" &&
                !canRefund &&
                ret.status !== "REFUND_COMPLETED" && (
                  <p className="w-full text-xs text-ink-soft">
                    {productReturned
                      ? "Product is back at the warehouse. Waiting for logistics to finish inspection — this page refreshes automatically."
                      : "Waiting for logistics to pick up and confirm warehouse receipt."}
                  </p>
                )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
