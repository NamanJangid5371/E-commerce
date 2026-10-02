"use client";

import { formatINR } from "@/lib/format";
import { labelReturnStatus } from "@/lib/return-labels";
import {
  adminReturnNextStep,
  fetchAdminReturns,
  type ReturnDto,
} from "@/lib/returns-api";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const STATUS_FILTERS = [
  "",
  "RETURN_REQUESTED",
  "RETURN_APPROVED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "IN_TRANSIT",
  "RECEIVED_AT_WAREHOUSE",
  "INSPECTION_PENDING",
  "INSPECTION_APPROVED",
  "REFUND_ELIGIBLE",
  "REFUND_INITIATED",
  "REFUND_COMPLETED",
  "RETURN_REJECTED",
  "INSPECTION_REJECTED",
  "RETURN_CANCELLED",
];

function needsAdminAction(status: string) {
  return status === "RETURN_REQUESTED" || status === "INSPECTION_APPROVED" || status === "REFUND_ELIGIBLE";
}

export default function ReturnsAdminPage() {
  const [rows, setRows] = useState<ReturnDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [total, setTotal] = useState(0);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const res = await fetchAdminReturns({
      status: status || undefined,
      q: q.trim() || undefined,
      page: 1,
    });
    if (!res.ok) {
      setError(res.error || "Could not load returns.");
      if (!opts?.silent) setRows([]);
      setLoading(false);
      return;
    }
    setRows(res.data.returns);
    setTotal(res.data.total);
    setError("");
    setLoading(false);
  }, [status, q]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load({ silent: true }), 4000);
    const onFocus = () => void load({ silent: true });
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Return management</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Logistics updates pickup and warehouse receipt here automatically. Approve returns, then mark
        refund eligible after inspection and generate refunds.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search order, RMA, customer, SKU…"
          className="min-w-[220px] flex-1 border border-line bg-transparent px-3 py-2 text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border border-line bg-transparent px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {STATUS_FILTERS.filter(Boolean).map((s) => (
            <option key={s} value={s}>
              {labelReturnStatus(s)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void load()}
          className="border border-line px-4 py-2 text-[11px] uppercase tracking-widest"
        >
          Refresh
        </button>
      </div>

      <p className="mt-3 text-xs text-ink-soft">
        {total} return{total === 1 ? "" : "s"}
        {loading ? " · refreshing…" : ""}
      </p>
      {error && <p className="mt-4 text-sm text-rose-800">{error}</p>}

      <div className="mt-6 space-y-3">
        {rows.map((r) => {
          const next = adminReturnNextStep(r);
          const returned = Boolean(r.warehouseReceivedAt || r.productVerified);
          return (
            <Link
              key={`${r.id}-${r.status}-${r.updatedAt ?? ""}`}
              href={`/admin/returns/${r.id}`}
              className="block border border-line p-4 transition hover:border-ink"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{r.returnNumber}</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    Order {r.orderId} · {r.customerEmail ?? "Guest"}
                  </p>
                  <p className="mt-2 text-sm">
                    {r.item.name} · {r.item.sku} · Qty {r.quantity}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-medium">{r.statusLabel}</p>
                  <p className="text-ink-soft">{formatINR(r.estimatedRefundAmount)}</p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {new Date(r.requestedAt).toLocaleString("en-IN")}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-sm text-ink-soft">Reason: {r.reason}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-widest">
                <span
                  className={
                    returned
                      ? "border border-ink bg-ink px-2 py-1 text-paper"
                      : "border border-line px-2 py-1 text-ink-soft"
                  }
                >
                  Product returned: {returned ? "Yes" : "No"}
                </span>
                {needsAdminAction(r.status) && (
                  <span className="border border-amber-800/40 bg-amber-50 px-2 py-1 text-amber-950">
                    Admin action needed
                  </span>
                )}
              </div>
              {next && <p className="mt-2 text-sm text-ink-soft">Next: {next}</p>}
            </Link>
          );
        })}
        {!loading && !rows.length && (
          <p className="text-sm text-ink-soft">No return requests match these filters.</p>
        )}
      </div>
    </div>
  );
}
