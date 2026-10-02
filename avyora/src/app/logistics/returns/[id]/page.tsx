"use client";

import { ReturnTrackingTimeline } from "@/components/return-tracking-timeline";
import { formatINR } from "@/lib/format";
import {
  fetchLogisticsReturn,
  postLogisticsReturnAction,
  type ReturnDto,
} from "@/lib/returns-api";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function LogisticsReturnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [ret, setRet] = useState<ReturnDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");
  const [tracking, setTracking] = useState("");
  const [courier, setCourier] = useState("");
  const [confirmMatch, setConfirmMatch] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await fetchLogisticsReturn(Array.isArray(id) ? id[0] : id);
    if (res.ok) {
      setRet(res.data);
      setTracking(res.data.trackingNumber ?? "");
      setCourier(res.data.courier ?? "");
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 6000);
    return () => window.clearInterval(t);
  }, [load]);

  async function act(action: string, extra?: Record<string, unknown>) {
    if (!ret) return;
    setBusy(true);
    setMsg("");
    const res = await postLogisticsReturnAction(ret.id, {
      action,
      note,
      trackingNumber: tracking || undefined,
      courier: courier || undefined,
      ...extra,
    });
    setBusy(false);
    if (!res.ok) {
      setMsg(res.error || "Action failed.");
      return;
    }
    setRet(res.data);
    setMsg("Updated.");
  }

  if (loading) return <p className="text-sm text-ink-soft">Loading return…</p>;
  if (!ret) {
    return (
      <div>
        Return not found.{" "}
        <Link href="/logistics/returns" className="underline">
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <Link href="/logistics/returns" className="text-sm underline">
          ← Return pickups
        </Link>
        <h1 className="mt-2 text-2xl font-medium tracking-tight sm:text-3xl">{ret.returnNumber}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {ret.statusLabel} · Order {ret.orderId}
        </p>
      </div>

      {msg && <p className="text-sm text-ink-soft">{msg}</p>}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-line bg-paper/60 p-5">
            <h2 className="text-lg font-medium">Product to collect</h2>
            <p className="mt-3 font-medium">{ret.item.name}</p>
            <p className="text-sm text-ink-soft">
              {ret.item.sku} · Qty {ret.quantity} · {formatINR(ret.estimatedRefundAmount)}
            </p>
            <p className="mt-2 text-sm text-ink-soft">Customer reason: {ret.reason}</p>
          </section>

          <section className="rounded-3xl border border-line bg-paper/60 p-5">
            <h2 className="text-lg font-medium">Shipment</h2>
            <label className="mt-3 block text-sm">
              Tracking number
              <input
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                className="mt-1 w-full border border-line bg-transparent px-3 py-2"
              />
            </label>
            <label className="mt-3 block text-sm">
              Courier
              <input
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
                className="mt-1 w-full border border-line bg-transparent px-3 py-2"
              />
            </label>
            <label className="mt-3 block text-sm">
              Note
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="mt-1 w-full border border-line bg-transparent px-3 py-2"
              />
            </label>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-3xl border border-line bg-paper/60 p-5">
            <h2 className="text-lg font-medium">Return progress</h2>
            <div className="mt-4">
              <ReturnTrackingTimeline ret={ret} />
            </div>
          </section>

          <section className="rounded-3xl border border-line bg-paper/60 p-5">
            <h2 className="text-lg font-medium">Logistics actions</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {ret.status === "RETURN_APPROVED" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act("schedule_pickup")}
                  className="border border-ink px-3 py-2 text-[11px] uppercase tracking-widest disabled:opacity-50"
                >
                  Schedule pickup
                </button>
              )}
              {ret.status === "PICKUP_SCHEDULED" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act("mark_picked_up")}
                  className="border border-ink px-3 py-2 text-[11px] uppercase tracking-widest disabled:opacity-50"
                >
                  Confirm picked up
                </button>
              )}
              {ret.status === "PICKED_UP" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act("mark_in_transit")}
                  className="border border-ink px-3 py-2 text-[11px] uppercase tracking-widest disabled:opacity-50"
                >
                  Mark in transit
                </button>
              )}
              {ret.status === "IN_TRANSIT" && (
                <div className="w-full space-y-3">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={confirmMatch}
                      onChange={(e) => setConfirmMatch(e.target.checked)}
                      className="mt-1"
                    />
                    <span>
                      I confirm the received product matches order item {ret.item.sku} (
                      {ret.item.name}).
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={busy || !confirmMatch}
                    onClick={() =>
                      void act("receive_warehouse", {
                        confirmProductMatch: true,
                        expectedOrderItemId: ret.orderItemId,
                      })
                    }
                    className="border border-ink bg-ink px-3 py-2 text-[11px] uppercase tracking-widest text-paper disabled:opacity-50"
                  >
                    Confirm warehouse receipt
                  </button>
                </div>
              )}
              {ret.status === "INSPECTION_PENDING" && (
                <div className="w-full space-y-3">
                  <p className="text-sm text-ink-soft">
                    Confirm inspection here. This unlocks refund eligibility for admin.
                  </p>
                  <div className="flex w-full flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act("approve_inspection", { inspectionNotes: note })}
                      className="border border-ink bg-ink px-3 py-2 text-[11px] uppercase tracking-widest text-paper disabled:opacity-50"
                    >
                      Confirm inspection
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act("reject_inspection", {
                          note: note || "Failed inspection",
                          inspectionNotes: note,
                        })
                      }
                      className="border border-line px-3 py-2 text-[11px] uppercase tracking-widest disabled:opacity-50"
                    >
                      Reject inspection
                    </button>
                  </div>
                </div>
              )}
              {ret.status === "INSPECTION_APPROVED" && (
                <p className="text-sm text-emerald-900">
                  Inspection confirmed. Admin will mark refund eligible and generate the refund.
                </p>
              )}
              {(ret.status === "REFUND_ELIGIBLE" ||
                ret.status === "REFUND_INITIATED" ||
                ret.status === "REFUND_COMPLETED") && (
                <p className="text-sm text-ink-soft">
                  Logistics complete. Refund is handled in the admin panel.
                </p>
              )}
              {ret.status === "RETURN_REQUESTED" && (
                <p className="text-sm text-ink-soft">
                  Waiting for admin to approve this return before pickup can start.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
