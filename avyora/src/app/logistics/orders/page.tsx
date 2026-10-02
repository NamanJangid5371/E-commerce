"use client";

import { formatINR } from "@/lib/format";
import {
  bulkPatchLogisticsOrders,
  fetchBulkShippingLabelPdf,
  fetchLogisticsOrders,
  hasPrintedShippingLabel,
  markShippingLabelPrinted,
} from "@/lib/logistics-api";
import {
  isDelayedShipment,
  isEligibleForShippingLabel,
  LOGISTICS_QUEUES,
  LOGISTICS_STATUSES,
  SHIPMENT_FLOW_STATUSES,
  orderMatchesQueue,
  orderSearchText,
  statusBadgeTone,
} from "@/lib/logistics-orders";
import { useShopStore } from "@/store/shop-store";
import type { Order, OrderStatus } from "@/store/shop-types";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

function LogisticsOrdersPage() {
  const searchParams = useSearchParams();
  const queue = searchParams.get("queue") ?? "";
  const queueLabel = LOGISTICS_QUEUES.find((item) => item.id === queue)?.label;
  const orders = useShopStore((s) => s.orders);
  const mergeOrders = useShopStore((s) => s.mergeOrders);
  const deliveryPartners = useShopStore((s) => s.ops.deliveryPartners);
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [status, setStatus] = useState("all");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [partner, setPartner] = useState("all");
  const [delayFilter, setDelayFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [sort, setSort] = useState("updated-desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<OrderStatus>("Packed");
  const [bulkPartner, setBulkPartner] = useState("");
  const [bulkMsg, setBulkMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [labelBusy, setLabelBusy] = useState(false);
  const [bulkPreviewUrl, setBulkPreviewUrl] = useState<string | null>(null);
  const [labelPrintTick, setLabelPrintTick] = useState(0);

  const urlQuery = searchParams.get("q") ?? "";
  useEffect(() => {
    if (urlQuery) setQ(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    setPage(1);
  }, [queue]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchLogisticsOrders({
        q: q.trim() || undefined,
        status: status !== "all" ? status : undefined,
        pageSize: 100,
        page: 1,
      });
      if (cancelled) return;
      if (res.ok && res.data?.orders) {
        mergeOrders(res.data.orders);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mergeOrders, q, status]);

  useEffect(() => {
    return () => {
      if (bulkPreviewUrl) URL.revokeObjectURL(bulkPreviewUrl);
    };
  }, [bulkPreviewUrl]);

  const partners = useMemo(
    () =>
      Array.from(
        new Set([
          ...deliveryPartners.map((partnerRecord) => partnerRecord.name),
          ...orders.map((o) => o.deliveryPartner).filter(Boolean),
        ]),
      ).sort(),
    [deliveryPartners, orders],
  );

  const dateMatches = (createdAt: string) => {
    if (dateFilter === "all") return true;
    const created = new Date(createdAt);
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startWeek = new Date(startToday);
    startWeek.setDate(startWeek.getDate() - 7);
    const startMonth = new Date(startToday);
    startMonth.setMonth(startMonth.getMonth() - 1);
    if (dateFilter === "today") return +created >= +startToday;
    if (dateFilter === "week") return +created >= +startWeek;
    if (dateFilter === "month") return +created >= +startMonth;
    return true;
  };

  const filtered = useMemo(() => {
    return [...orders]
      .filter((order) => {
        if (queue && !orderMatchesQueue(order, queue)) return false;
        if (status !== "all" && order.status !== status) return false;
        if (paymentStatus !== "all" && (order.paymentStatus ?? "Success") !== paymentStatus) return false;
        if (partner !== "all" && (order.deliveryPartner ?? "Unassigned") !== partner) return false;
        if (delayFilter === "delayed" && !isDelayedShipment(order)) return false;
        if (delayFilter === "on-time" && isDelayedShipment(order)) return false;
        if (!dateMatches(order.createdAt)) return false;
        if (q && !orderSearchText(order).includes(q.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "updated-desc")
          return +new Date(b.lastUpdatedAt ?? b.createdAt) - +new Date(a.lastUpdatedAt ?? a.createdAt);
        if (sort === "created-desc") return +new Date(b.createdAt) - +new Date(a.createdAt);
        if (sort === "eta-asc")
          return (
            +new Date(a.estimatedDeliveryDate ?? "9999-12-31") -
            +new Date(b.estimatedDeliveryDate ?? "9999-12-31")
          );
        if (sort === "value-desc") return b.total - a.total;
        return a.id.localeCompare(b.id);
      });
  }, [orders, status, paymentStatus, partner, delayFilter, q, dateFilter, sort, queue]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  /** New pack-ready orders that should get labels (excludes unpaid/cancelled/etc.). */
  const eligibleNewOrders = useMemo(
    () => filtered.filter((order) => isEligibleForShippingLabel(order).ok),
    [filtered],
  );

  /** Eligible and not yet printed on this device — primary bulk target. */
  const unprintedEligibleOrders = useMemo(
    () => eligibleNewOrders.filter((order) => !hasPrintedShippingLabel(order.id)),
    // labelPrintTick refreshes after bulk print marks localStorage
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eligibleNewOrders, labelPrintTick],
  );

  const selectedEligibleOrders = useMemo(() => {
    const selected = new Set(selectedIds);
    return filtered.filter((order) => selected.has(order.id) && isEligibleForShippingLabel(order).ok);
  }, [filtered, selectedIds]);

  function toggleSelection(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]));
  }

  async function applyBulkStatus() {
    if (!selectedIds.length) return;
    if (!window.confirm(`Are you sure you want to update ${selectedIds.length} shipments to ${bulkStatus}?`))
      return;
    setBusy(true);
    const res = await bulkPatchLogisticsOrders({
      ids: selectedIds,
      action: { kind: "status", status: bulkStatus },
    });
    setBusy(false);
    if (!res.ok) {
      setBulkMsg(res.error || "Bulk status update failed.");
      return;
    }
    if (res.data.orders.length) mergeOrders(res.data.orders);
    setBulkMsg(`${res.data.success} updated, ${res.data.failed} failed.`);
    setSelectedIds([]);
  }

  async function applyBulkPartner() {
    const nextPartner = bulkPartner.trim();
    if (!selectedIds.length || !nextPartner) return;
    if (!window.confirm(`Are you sure you want to assign ${nextPartner} to ${selectedIds.length} shipments?`))
      return;
    setBusy(true);
    const res = await bulkPatchLogisticsOrders({
      ids: selectedIds,
      action: { kind: "partner", deliveryPartner: nextPartner },
    });
    setBusy(false);
    if (!res.ok) {
      setBulkMsg(res.error || "Bulk partner update failed.");
      return;
    }
    if (res.data.orders.length) mergeOrders(res.data.orders);
    setBulkMsg(`${res.data.success} updated, ${res.data.failed} failed.`);
    setSelectedIds([]);
  }

  async function runBulkLabels(targetOrders: Order[], modeLabel: string) {
    if (!targetOrders.length) {
      setBulkMsg(
        "No eligible new orders to label. Labels are only for Confirmed / Processing / Packed / Ready to Ship — not Pending Payment, Cancelled, Returned, etc.",
      );
      return;
    }

    const previewList = targetOrders
      .slice(0, 12)
      .map((o) => `${o.id} · ${o.address.name} · ${o.address.city} ${o.address.pincode}`)
      .join("\n");
    const more = targetOrders.length > 12 ? `\n…and ${targetOrders.length - 12} more` : "";
    if (
      !window.confirm(
        `Print ${targetOrders.length} shipping label(s) (${modeLabel})?\n\nOnly eligible new orders are included. Unpaid / cancelled / returned orders are skipped.\n\n${previewList}${more}`,
      )
    ) {
      return;
    }

    setLabelBusy(true);
    setBulkMsg("");
    const res = await fetchBulkShippingLabelPdf(targetOrders.map((o) => o.id));
    setLabelBusy(false);
    if (!res.ok) {
      setBulkMsg(res.error);
      return;
    }

    if (bulkPreviewUrl) URL.revokeObjectURL(bulkPreviewUrl);
    const url = URL.createObjectURL(res.blob);
    setBulkPreviewUrl(url);

    for (const order of targetOrders.slice(0, res.count)) {
      markShippingLabelPrinted(order.id);
    }
    setLabelPrintTick((n) => n + 1);

    setBulkMsg(
      `Generated ${res.count} label(s)${res.skipped ? `, skipped ${res.skipped}` : ""}. Review the preview, then print.`,
    );
  }

  function printBulkPreview() {
    if (!bulkPreviewUrl) return;
    const w = window.open(bulkPreviewUrl, "_blank", "noopener,noreferrer");
    if (!w) {
      setBulkMsg("Pop-up blocked. Allow pop-ups to print the bulk label PDF.");
      return;
    }
    window.setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        // PDF viewer toolbar print is fine
      }
    }, 600);
  }

  function closeBulkPreview() {
    if (bulkPreviewUrl) URL.revokeObjectURL(bulkPreviewUrl);
    setBulkPreviewUrl(null);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">Logistics orders</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {queueLabel ? `${queueLabel}. ` : ""}Search, filter, and update shipment operations.
          </p>
        </div>
        <div className="text-sm text-ink-soft sm:text-right">
          <p>{filtered.length} shown</p>
          <p className="text-xs">
            {unprintedEligibleOrders.length} new eligible labels · {eligibleNewOrders.length} eligible total
          </p>
        </div>
      </div>

      <div className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        {LOGISTICS_QUEUES.map((item) => (
          <Link
            key={item.id}
            href={`/logistics/orders?queue=${item.id}`}
            className={`inline-flex min-h-11 shrink-0 items-center border px-3 text-[11px] uppercase tracking-widest ${
              queue === item.id ? "border-ink bg-ink text-ivory" : "border-line"
            }`}
          >
            {item.label}
          </Link>
        ))}
        {queue ? (
          <Link href="/logistics/orders" className="px-3 py-1.5 text-[11px] uppercase tracking-widest underline">
            Clear queue
          </Link>
        ) : null}
      </div>

      <div className="mt-4 space-y-3 rounded-3xl border border-line bg-paper/85 p-4 backdrop-blur xl:sticky xl:top-4 xl:z-10">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr]">
          <input
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder="Search order ID, customer, phone, email, tracking, partner"
            className="w-full border border-line bg-transparent px-3 py-2 text-sm"
          />
          <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} className="border border-line bg-transparent px-3 py-2 text-sm">
            <option value="all">All statuses</option>
            {LOGISTICS_STATUSES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select value={paymentStatus} onChange={(e) => { setPage(1); setPaymentStatus(e.target.value); }} className="border border-line bg-transparent px-3 py-2 text-sm">
            <option value="all">All payments</option>
            <option value="Success">Success</option>
            <option value="Pending">Pending</option>
            <option value="Failed">Failed</option>
          </select>
          <select value={partner} onChange={(e) => { setPage(1); setPartner(e.target.value); }} className="border border-line bg-transparent px-3 py-2 text-sm">
            <option value="all">All partners</option>
            {partners.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select value={delayFilter} onChange={(e) => { setPage(1); setDelayFilter(e.target.value); }} className="border border-line bg-transparent px-3 py-2 text-sm">
            <option value="all">All SLA</option>
            <option value="delayed">Delayed</option>
            <option value="on-time">On time</option>
          </select>
          <select value={dateFilter} onChange={(e) => { setPage(1); setDateFilter(e.target.value); }} className="border border-line bg-transparent px-3 py-2 text-sm">
            <option value="all">All dates</option>
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
          </select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_0.8fr_0.8fr_1fr]">
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="border border-line bg-transparent px-3 py-2 text-sm">
            <option value="updated-desc">Sort: latest updated</option>
            <option value="created-desc">Sort: newest created</option>
            <option value="eta-asc">Sort: earliest ETA</option>
            <option value="value-desc">Sort: highest value</option>
            <option value="id-asc">Sort: order ID</option>
          </select>
          <select value={String(pageSize)} onChange={(e) => { setPage(1); setPageSize(Number(e.target.value)); }} className="border border-line bg-transparent px-3 py-2 text-sm">
            {[10, 20, 50].map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as OrderStatus)} className="border border-line bg-transparent px-3 py-2 text-sm">
            <optgroup label="Shipment flow">
              {SHIPMENT_FLOW_STATUSES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </optgroup>
            <optgroup label="Return (high-level)">
              <option>Return Pickup</option>
              <option>Returned</option>
            </optgroup>
          </select>
          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:flex-wrap xl:col-span-1">
            <button type="button" onClick={applyBulkStatus} disabled={busy || !selectedIds.length} className="min-h-11 border border-line px-3 py-2 text-[11px] uppercase tracking-widest disabled:opacity-40">
              Bulk status
            </button>
            <select value={bulkPartner} onChange={(e) => setBulkPartner(e.target.value)} className="min-w-0 flex-1 border border-line bg-transparent px-3 py-2 text-sm">
              <option value="">Bulk partner</option>
              {partners.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <button type="button" onClick={applyBulkPartner} disabled={busy || !selectedIds.length || !bulkPartner.trim()} className="min-h-11 border border-line px-3 py-2 text-[11px] uppercase tracking-widest disabled:opacity-40">
              Assign partner
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <p className="mr-2 text-[11px] uppercase tracking-widest text-ink-soft">Sticky labels</p>
          <button
            type="button"
            disabled={labelBusy || unprintedEligibleOrders.length === 0}
            onClick={() => void runBulkLabels(unprintedEligibleOrders, "new unprinted eligible")}
            className="btn-primary min-h-11 w-full disabled:opacity-40 sm:w-auto"
            title="Confirmed / Processing / Packed / Ready to Ship only — skips unpaid, cancelled, returned"
          >
            {labelBusy ? "Generating…" : `Print all new labels (${unprintedEligibleOrders.length})`}
          </button>
          <button
            type="button"
            disabled={labelBusy || selectedEligibleOrders.length === 0}
            onClick={() => void runBulkLabels(selectedEligibleOrders, "selected eligible")}
            className="min-h-11 w-full border border-line px-3 py-2 text-[11px] uppercase tracking-widest disabled:opacity-40 sm:w-auto"
          >
            Print selected labels ({selectedEligibleOrders.length})
          </button>
          <p className="text-xs text-ink-soft">
            Skips Pending Payment, Cancelled, Refunded, Returned, and already-shipped statuses.
          </p>
        </div>
        {bulkMsg && <p className="text-sm text-ink-soft">{bulkMsg}</p>}
      </div>

      <div className="mt-6 overflow-hidden rounded-3xl border border-line bg-paper/60">
        <div className="hidden grid-cols-[0.3fr_1.1fr_1.1fr_1fr_0.7fr_0.8fr_0.9fr_0.9fr_1fr] gap-3 border-b border-line bg-ivory/80 px-4 py-3 text-[10px] tracking-[0.16em] uppercase text-ink-soft xl:grid">
          <span>Select</span>
          <span>Order</span>
          <span>Customer</span>
          <span>Status</span>
          <span>Payment</span>
          <span>ETA</span>
          <span>SLA</span>
          <span>Tracking</span>
          <span className="text-right">Actions</span>
        </div>
        <div className="divide-y divide-line">
          {paginated.map((order) => {
            const eligible = isEligibleForShippingLabel(order).ok;
            return (
              <div
                key={order.id}
                className="flex flex-col gap-3 px-4 py-4 xl:grid xl:grid-cols-[0.3fr_1.1fr_1.1fr_1fr_0.7fr_0.8fr_0.9fr_0.9fr_1fr] xl:items-center"
              >
                <label className="flex items-center gap-3 xl:justify-center">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={selectedIds.includes(order.id)}
                    onChange={() => toggleSelection(order.id)}
                  />
                  <span className="text-xs uppercase tracking-widest text-ink-soft xl:hidden">Select</span>
                </label>
                <div className="min-w-0">
                  <p className="break-all font-medium">{order.id}</p>
                  <p className="text-xs text-ink-soft">{new Date(order.createdAt).toLocaleString("en-IN")}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] tracking-[0.14em] uppercase text-ink-soft xl:hidden">Customer</p>
                  <p className="break-words">{order.address.name}</p>
                  <p className="text-xs text-ink-soft">
                    {order.customerEmail ?? "Guest"} · {order.address.phone}
                  </p>
                </div>
                <div>
                  <p
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                      statusBadgeTone(order.status) === "rose"
                        ? "bg-rose-100 text-rose-900"
                        : statusBadgeTone(order.status) === "amber"
                          ? "bg-amber-100 text-amber-900"
                          : statusBadgeTone(order.status) === "blue"
                            ? "bg-sky-100 text-sky-900"
                            : statusBadgeTone(order.status) === "emerald"
                              ? "bg-emerald-100 text-emerald-900"
                              : "bg-stone-100 text-stone-900"
                    }`}
                  >
                    {order.status}
                  </p>
                  <p className="text-xs text-ink-soft">{order.deliveryPartner ?? "Partner pending"}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-ink-soft lg:grid-cols-4 xl:contents">
                <div>
                  <p className="text-[10px] tracking-[0.14em] uppercase text-ink-soft xl:hidden">Payment</p>
                  {order.paymentStatus ?? "Success"}
                  <span className="mt-0.5 block text-xs">{order.paymentMethod ?? "Razorpay"}</span>
                </div>
                <div className="text-sm text-ink-soft">
                  <p className="text-[10px] tracking-[0.14em] uppercase xl:hidden">ETA</p>
                  {order.estimatedDeliveryDate
                    ? new Date(order.estimatedDeliveryDate).toLocaleDateString("en-IN")
                    : "Not set"}
                </div>
                <div className="text-sm">
                  <p className="mb-1 text-[10px] tracking-[0.14em] uppercase text-ink-soft xl:hidden">SLA</p>
                  {isDelayedShipment(order) ? (
                    <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-900">
                      Delayed
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-900">
                      On time
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] tracking-[0.14em] uppercase text-ink-soft xl:hidden">Tracking</p>
                  <p className="break-all">{order.trackingId ?? "Pending"}</p>
                  <p className="text-xs text-ink-soft">{formatINR(order.total)}</p>
                </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap xl:justify-end">
                  <Link
                    href={`/logistics/orders/${order.id}`}
                    className="inline-flex min-h-11 items-center justify-center border border-line px-3 py-1.5 text-center text-[11px] uppercase tracking-widest"
                  >
                    View
                  </Link>
                  {eligible ? (
                    <Link
                      href={`/logistics/orders/${order.id}#shipping-label`}
                      className="inline-flex min-h-11 items-center justify-center border border-line px-3 py-1.5 text-center text-[11px] uppercase tracking-widest"
                    >
                      {hasPrintedShippingLabel(order.id) ? "Reprint Label" : "Print Label"}
                    </Link>
                  ) : (
                    <span
                      className="inline-flex min-h-11 items-center justify-center border border-dashed border-line px-3 py-1.5 text-center text-[11px] uppercase tracking-widest text-ink-soft opacity-60"
                      title="Not eligible for a new shipping label"
                    >
                      No label
                    </span>
                  )}
                  <Link
                    href={`/orders/${order.id}`}
                    target="_blank"
                    className="inline-flex min-h-11 items-center justify-center border border-line px-3 py-1.5 text-center text-[11px] uppercase tracking-widest"
                  >
                    Track
                  </Link>
                </div>
              </div>
            );
          })}
          {!paginated.length && (
            <p className="px-4 py-10 text-sm text-ink-soft">No orders match the current filters.</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          Page {page} of {totalPages} · {selectedIds.length} selected
        </p>
        <div className="flex w-full gap-2 sm:w-auto">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="min-h-11 flex-1 border border-line px-3 py-2 text-sm disabled:opacity-40 sm:flex-none"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="min-h-11 flex-1 border border-line px-3 py-2 text-sm disabled:opacity-40 sm:flex-none"
          >
            Next
          </button>
        </div>
      </div>

      {bulkPreviewUrl && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <div className="flex h-[100dvh] w-full max-w-4xl flex-col border border-line bg-paper shadow-lg sm:h-[90vh]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-ink-soft">Bulk label preview</p>
                <p className="font-medium">One sticky label per page · confirm before printing</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={bulkPreviewUrl}
                  download="shipping-labels-bulk.pdf"
                  className="border border-line px-3 py-2 text-[11px] uppercase tracking-widest"
                >
                  Download PDF
                </a>
                <button type="button" onClick={printBulkPreview} className="btn-primary">
                  Print all
                </button>
                <button type="button" onClick={closeBulkPreview} className="border border-line px-3 py-2 text-sm">
                  Close
                </button>
              </div>
            </div>
            <iframe title="Bulk shipping labels" src={bulkPreviewUrl} className="min-h-0 flex-1 w-full bg-white" />
          </div>
        </div>
      )}
    </div>
  );
}

export default function LogisticsOrdersRoute() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-soft">Loading orders…</p>}>
      <LogisticsOrdersPage />
    </Suspense>
  );
}
