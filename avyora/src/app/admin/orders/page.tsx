"use client";

import { formatINR } from "@/lib/format";
import { fetchJson } from "@/lib/api-client";
import { filterSales, saleAmount, sumSales } from "@/lib/sales";
import { useShopStore } from "@/store/shop-store";
import type { Order } from "@/store/shop-types";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

const statuses: Order["status"][] = [
  "Pending Payment",
  "Confirmed",
  "Processing",
  "Packed",
  "Ready to Ship",
  "Shipped",
  "In Transit",
  "Out for Delivery",
  "Delivered",
  "Cancelled",
  "Failed Delivery",
  "Return Requested",
  "Return Pickup",
  "Returned",
  "RTO",
  "Refunded",
];

function resolveStatusFilter(raw: string | null): string {
  if (!raw || raw === "all") return "all";
  return statuses.includes(raw as Order["status"]) ? raw : "all";
}

export default function AdminOrdersPage() {
  return (
    <Suspense fallback={<div className="text-sm text-ink-soft">Loading orders…</div>}>
      <AdminOrders />
    </Suspense>
  );
}

function AdminOrders() {
  const storeOrders = useShopStore((s) => s.orders);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [filter, setFilter] = useState(() => resolveStatusFilter(searchParams.get("status")));
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Order[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setFilter(resolveStatusFilter(searchParams.get("status")));
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const collected: Order[] = [];
      let page = 1;
      let totalPages = 1;
      let lastError = "";
      while (page <= totalPages && page <= 20 && !cancelled) {
        const res = await fetchJson<{
          orders: Order[];
          totalPages?: number;
        }>(`/api/admin/orders?page=${page}&limit=100`);
        if (!res.ok) {
          lastError = res.error;
          break;
        }
        collected.push(...(res.data.orders ?? []));
        totalPages = res.data.totalPages ?? 1;
        page += 1;
      }
      if (cancelled) return;
      if (collected.length) {
        setRemote(collected);
        useShopStore.setState({ orders: collected });
        setError("");
      } else {
        setRemote(null);
        setError(lastError || "Could not load orders from the database.");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function applyFilter(next: string) {
    setFilter(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("status");
    else params.set("status", next);
    const qs = params.toString();
    router.replace(qs ? `/admin/orders?${qs}` : "/admin/orders", { scroll: false });
  }

  const orders = remote ?? storeOrders;

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: orders.length };
    for (const s of statuses) map[s] = 0;
    for (const o of orders) map[o.status] = (map[o.status] ?? 0) + 1;
    return map;
  }, [orders]);

  /** Chips for statuses that have orders, plus the active filter if it is empty. */
  const primaryStatuses = useMemo(() => {
    const withOrders = statuses.filter((s) => (counts[s] ?? 0) > 0);
    if (filter !== "all" && !withOrders.includes(filter as Order["status"])) {
      return [...withOrders, filter as Order["status"]];
    }
    return withOrders;
  }, [counts, filter]);

  const moreStatuses = useMemo(
    () => statuses.filter((s) => !(counts[s] > 0) && s !== filter),
    [counts, filter],
  );

  const list = useMemo(() => {
    return orders
      .filter((o) => {
        const matchF = filter === "all" || o.status === filter;
        const matchQ =
          !q ||
          `${o.id} ${o.address.name} ${o.address.phone} ${o.customerEmail} ${o.trackingId} ${o.deliveryPartner} ${o.items.map((i) => i.name).join(" ")}`
            .toLowerCase()
            .includes(q.toLowerCase());
        return matchF && matchQ;
      })
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [orders, filter, q]);

  const revenue = useMemo(() => sumSales(list), [list]);

  const salesOrders = useMemo(() => filterSales(list).filter((o) => saleAmount(o) > 0), [list]);

  function escapeCsv(value: string | number | undefined) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function downloadSalesCsv() {
    if (!salesOrders.length) {
      window.alert("No confirmed paid orders are available in the current view.");
      return;
    }

    const header = [
      "Order ID",
      "Order Date",
      "Customer Name",
      "Customer Email",
      "Phone",
      "Status",
      "Payment Status",
      "Payment Method",
      "Total",
      "Tracking ID",
      "Delivery Partner",
      "Shipment Date",
      "Estimated Delivery Date",
    ];

    const rows = salesOrders.map((order) => {
      const shippedAt = order.trackingEvents?.find((event) => event.status === "Shipped" || event.status === "In Transit")?.at;
      return [
        order.id,
        new Date(order.createdAt).toLocaleString("en-IN"),
        order.address.name,
        order.customerEmail ?? "",
        order.address.phone,
        order.status,
        order.paymentStatus ?? "Success",
        order.paymentMethod ?? "Razorpay",
        order.total,
        order.trackingId ?? "",
        order.deliveryPartner ?? "",
        shippedAt ? new Date(shippedAt).toLocaleDateString("en-IN") : order.estimatedShippingDate ? new Date(order.estimatedShippingDate).toLocaleDateString("en-IN") : "",
        order.estimatedDeliveryDate ? new Date(order.estimatedDeliveryDate).toLocaleDateString("en-IN") : "",
      ];
    });

    const csv = [header, ...rows]
      .map((row) => row.map((value) => escapeCsv(value)).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `avyora-sales-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium tracking-tight">Orders</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Fulfilment, payment status, tracking, and customer delivery details.
          </p>
          {loading && <p className="mt-2 text-xs text-ink-soft">Loading orders from database…</p>}
          {error && <p className="mt-2 text-xs text-red-800">{error}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink-soft">
            {list.length} shown · {formatINR(revenue)} in view
          </p>
          <button
            type="button"
            onClick={downloadSalesCsv}
            className="border border-line px-4 py-2 text-[11px] tracking-widest uppercase transition hover:border-ink"
          >
            Download sales CSV
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="flex max-w-full items-center gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Filter orders by status"
        >
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            onClick={() => applyFilter("all")}
            className={`shrink-0 border-b-2 px-2.5 py-2 text-[11px] tracking-[0.12em] uppercase transition ${
              filter === "all"
                ? "border-ink text-ink"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            All
            <span className="ml-1.5 tabular-nums text-ink-soft">{counts.all}</span>
          </button>
          {primaryStatuses.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={filter === s}
              onClick={() => applyFilter(s)}
              className={`shrink-0 border-b-2 px-2.5 py-2 text-[11px] tracking-[0.12em] uppercase transition ${
                filter === s
                  ? "border-ink text-ink"
                  : "border-transparent text-ink-soft hover:text-ink"
              }`}
            >
              {s}
              <span className="ml-1.5 tabular-nums text-ink-soft">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>

        {moreStatuses.length > 0 && (
          <label className="flex shrink-0 items-center gap-2 text-[11px] tracking-[0.12em] uppercase text-ink-soft">
            <span className="sr-only">Other statuses</span>
            <select
              value=""
              aria-label="Filter by other status"
              onChange={(e) => {
                const next = e.target.value;
                if (next) applyFilter(next);
              }}
              className="max-w-[14rem] cursor-pointer border border-line bg-transparent px-2.5 py-2 text-[11px] tracking-[0.08em] text-ink outline-none transition hover:border-ink"
            >
              <option value="">More statuses…</option>
              {moreStatuses.map((s) => (
                <option key={s} value={s}>
                  {s} ({counts[s] ?? 0})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search number, customer, phone, email, tracking, product"
          className="min-w-64 flex-1 border border-line bg-transparent px-3 py-2 text-sm"
        />
      </div>
      <p className="mt-3 text-sm text-ink-soft">Shipment status, tracking, partner, and COD fulfilment updates are managed only from the logistics portal.</p>

      <div className="mt-6 overflow-hidden border border-line">
        <div className="hidden grid-cols-[1.1fr_1.2fr_1fr_0.8fr_0.7fr] gap-3 border-b border-line bg-ivory/80 px-4 py-3 text-[10px] tracking-[0.16em] uppercase text-ink-soft md:grid">
          <span>Order</span>
          <span>Customer</span>
          <span>Status</span>
          <span>Payment</span>
          <span className="text-right">Total</span>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {list.map((o) => (
            <div
              key={o.id}
              className="grid gap-2 px-4 py-4 text-sm transition hover:bg-ivory/60 md:grid-cols-[1.1fr_1.2fr_1fr_0.8fr_0.7fr] md:items-center md:gap-3"
            >
              <div>
                <Link href={`/admin/orders/${o.id}`} className="font-medium underline-offset-4 hover:underline">
                  {o.id}
                </Link>
                <p className="text-xs text-ink-soft">{new Date(o.createdAt).toLocaleString("en-IN")}</p>
              </div>
              <div>
                <p>{o.address.name}</p>
                <p className="text-xs text-ink-soft">
                  {o.customerEmail ?? "Guest"} · {o.items.length} item{o.items.length === 1 ? "" : "s"}
                </p>
              </div>
              <div>
                <p>{o.status}</p>
                <p className="text-xs text-ink-soft">
                  {o.trackingId ? `Track ${o.trackingId}` : "Tracking pending"}
                  {o.deliveryPartner ? ` · ${o.deliveryPartner}` : ""}
                </p>
              </div>
              <div className="text-ink-soft">
                {o.paymentStatus ?? "Success"}
                <span className="mt-0.5 block text-xs">{o.paymentMethod ?? "Razorpay"}</span>
              </div>
              <p className="font-medium md:text-right">{formatINR(o.total)}</p>
            </div>
          ))}
          {!list.length && <p className="px-4 py-10 text-sm text-ink-soft">No orders in this view.</p>}
        </div>
      </div>
    </div>
  );
}
