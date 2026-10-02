"use client";

import { SalesTrendChart } from "@/components/admin/sales-trend-chart";
import { TrendChart } from "@/components/admin/trend-chart";
import { variantStock } from "@/data/catalog";
import { formatCount, formatINR } from "@/lib/format";
import { monthRange, monthlyVisits } from "@/lib/monthly-analytics";
import { saleAmount, sumSales, todayPlacedOrders, todaySalesOrders } from "@/lib/sales";
import { isPublished, useShopStore } from "@/store/shop-store";
import type { Order } from "@/store/shop-types";
import {
  BadgePercent,
  ClipboardList,
  ImageIcon,
  PackagePlus,
  ScrollText,
  TriangleAlert,
  CalendarDays,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchJson } from "@/lib/api-client";
import { fetchAdminReturns } from "@/lib/returns-api";

const STATUS_CHIPS: {
  status: Order["status"];
  tone: string;
}[] = [
  { status: "Confirmed", tone: "border-sky-200/80 bg-sky-50 text-sky-950 hover:border-sky-300 hover:bg-sky-100/90" },
  { status: "Packed", tone: "border-teal-200/80 bg-teal-50 text-teal-950 hover:border-teal-300 hover:bg-teal-100/90" },
  { status: "Shipped", tone: "border-cyan-200/80 bg-cyan-50 text-cyan-950 hover:border-cyan-300 hover:bg-cyan-100/90" },
  { status: "Delivered", tone: "border-emerald-200/80 bg-emerald-50 text-emerald-950 hover:border-emerald-300 hover:bg-emerald-100/90" },
  { status: "Cancelled", tone: "border-rose-200/80 bg-rose-50 text-rose-950 hover:border-rose-300 hover:bg-rose-100/90" },
  { status: "Return Requested", tone: "border-amber-200/80 bg-amber-50 text-amber-950 hover:border-amber-300 hover:bg-amber-100/90" },
  { status: "Refunded", tone: "border-stone-300/80 bg-stone-100 text-stone-900 hover:border-stone-400 hover:bg-stone-200/80" },
];

const QUICK_ACTIONS = [
  { href: "/admin/products/new", label: "Add product", hint: "Create a catalogue piece", Icon: PackagePlus },
  { href: "/admin/appointments", label: "Atelier visits", hint: "Diary & bookings", Icon: CalendarDays },
  { href: "/admin/orders", label: "Process orders", hint: "Fulfilment queue", Icon: ClipboardList },
  { href: "/admin/inventory", label: "Stock alerts", hint: "Low & out of stock", Icon: TriangleAlert },
  { href: "/admin/coupons", label: "New coupon", hint: "Promotions", Icon: BadgePercent },
  { href: "/admin/banners", label: "Homepage banner", hint: "Campaign creative", Icon: ImageIcon },
  { href: "/admin/reports", label: "Reports", hint: "Sales & exports", Icon: ScrollText },
] as const;

export default function AdminHome() {
  const catalog = useShopStore((s) => s.catalog);
  const orders = useShopStore((s) => s.orders);
  const customers = useShopStore((s) => s.customers);
  const coupons = useShopStore((s) => s.coupons);
  const campaigns = useShopStore((s) => s.campaigns);
  const appointments = useShopStore((s) => s.appointments);
  const visits = useShopStore((s) => s.ops?.visits);
  const reviews = catalog.flatMap((p) => p.reviews.map((r) => ({ p, r })));
  const [returnsCount, setReturnsCount] = useState(0);
  const [refundQueueCount, setRefundQueueCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ordersAcc: Order[] = [];
      const customersAcc: typeof customers = [];
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages && page <= 20 && !cancelled) {
        const ordersRes = await fetchJson<{ orders: Order[]; totalPages?: number }>(
          `/api/admin/orders?page=${page}&limit=100`,
        );
        if (!ordersRes.ok) break;
        ordersAcc.push(...(ordersRes.data.orders ?? []));
        totalPages = ordersRes.data.totalPages ?? 1;
        page += 1;
      }
      page = 1;
      totalPages = 1;
      while (page <= totalPages && page <= 20 && !cancelled) {
        const customersRes = await fetchJson<{
          customers: typeof customers;
          totalPages?: number;
        }>(`/api/admin/customers?page=${page}&limit=100`);
        if (!customersRes.ok) break;
        customersAcc.push(...(customersRes.data.customers ?? []));
        totalPages = customersRes.data.totalPages ?? 1;
        page += 1;
      }
      const returnsRes = await fetchAdminReturns({ page: 1 });
      const refundRes = await fetchJson<{ total?: number }>("/api/admin/refund-queue");
      if (cancelled) return;
      if (ordersAcc.length) useShopStore.setState({ orders: ordersAcc });
      if (customersAcc.length) useShopStore.setState({ customers: customersAcc });
      if (returnsRes.ok) setReturnsCount(returnsRes.data.total);
      if (refundRes.ok) setRefundQueueCount(refundRes.data.total ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const months = useMemo(() => monthRange(undefined, undefined, 12), []);
  const visitSeries = useMemo(() => monthlyVisits(visits, months), [visits, months]);

  const revenue = sumSales(orders);
  const todayOrders = todayPlacedOrders(orders);
  const todaySales = sumSales(todaySalesOrders(orders));
  const live = catalog.filter(isPublished).length;
  const low = catalog.flatMap((p) =>
    p.variants.filter((v) => v.stock <= (p.minStock ?? 3)).map((v) => ({ name: p.name, sku: v.sku, stock: v.stock })),
  );
  const out = catalog.filter((p) => variantStock(p) === 0);
  const todayKey = new Date().toISOString().slice(0, 10);
  const upcomingVisits = appointments.filter(
    (a) => (a.status === "requested" || a.status === "confirmed") && a.date >= todayKey,
  );
  const statusCount = (s: string) => orders.filter((o) => o.status === s).length;
  /** Bestsellers from recognized sales only. */
  const unitsSold = useMemo(() => {
    const map = new Map<string, { name: string; category: string; units: number }>();
    for (const order of orders) {
      if (!saleAmount(order)) continue;
      for (const item of order.items) {
        const product = catalog.find((p) => p.id === item.productId);
        const current = map.get(item.productId) ?? {
          name: item.name,
          category: product?.category ?? "—",
          units: 0,
        };
        current.units += item.quantity;
        map.set(item.productId, current);
      }
    }
    return [...map.values()].sort((a, b) => b.units - a.units).slice(0, 5);
  }, [orders, catalog]);
  const catPerf = catalog.reduce<Record<string, number>>((acc, p) => {
    acc[p.category] = (acc[p.category] ?? 0) + 1;
    return acc;
  }, {});

  const orderFallbackReturns = orders.filter((o) =>
    ["Return Requested", "Return Pickup", "Returned", "Refunded", "RTO"].includes(o.status),
  ).length;
  const returnsTotal = returnsCount || orderFallbackReturns;

  const kpis: { label: string; value: string; href?: string }[] = [
    { label: "Total revenue", value: formatINR(revenue) },
    { label: "Today's sales", value: formatINR(todaySales) },
    { label: "Today's orders", value: String(todayOrders.length) },
    { label: "Customers", value: String(customers.length) },
    { label: "Active products", value: String(live) },
    { label: "Returns", value: String(returnsTotal), href: "/admin/returns" },
    { label: "Refund queue", value: String(refundQueueCount), href: "/admin/payments" },
    { label: "Upcoming visits", value: String(upcomingVisits.length) },
  ];

  const quick = QUICK_ACTIONS;

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Live figures from your catalogue and real orders — no demo sales data.
      </p>
      {refundQueueCount > 0 ? (
        <Link
          href="/admin/payments"
          className="mt-6 block border border-amber-900/30 bg-amber-50/70 px-4 py-3 text-sm text-amber-950 transition hover:bg-amber-50"
        >
          <span className="font-medium">
            {refundQueueCount} paid cancellation{refundQueueCount === 1 ? "" : "s"} need a refund
          </span>
          <span className="mt-0.5 block text-ink-soft">
            Customer cancelled after payment — open Payments to release the refund for those products.
          </span>
        </Link>
      ) : null}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-8">
        {kpis.map((kpi) => {
          const className = "border border-line bg-paper p-4";
          const body = (
            <>
              <p className="text-[11px] tracking-widest uppercase text-gold-deep">{kpi.label}</p>
              <p className="mt-2 text-2xl font-medium">{kpi.value}</p>
            </>
          );
          return kpi.href ? (
            <Link key={kpi.label} href={kpi.href} className="block">
              <div className={className}>{body}</div>
            </Link>
          ) : (
            <div key={kpi.label} className={className}>
              {body}
            </div>
          );
        })}
      </div>
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <SalesTrendChart orders={orders} />
        <TrendChart
          title="Monthly site visits"
          subtitle="Storefront sessions over the last 12 months"
          data={visitSeries}
          formatTick={formatCount}
          formatTip={(p) => `${formatCount(p.value)} visits`}
          variant="area"
          color="#1c1c1c"
        />
      </div>

      <div className="mt-8">
        <p className="text-[11px] tracking-[0.16em] uppercase text-gold-deep">Order pipeline</p>
        <div className="mt-3 flex flex-wrap gap-2.5">
          {STATUS_CHIPS.map(({ status, tone }) => {
            const count = statusCount(status);
            return (
              <Link
                key={status}
                href={`/admin/orders?status=${encodeURIComponent(status)}`}
                className={`group inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-[0_1px_0_rgba(28,28,28,0.04)] transition duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--gold-deep)] ${tone}`}
              >
                <span className="opacity-90">{status}</span>
                <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-white/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-black/5 transition group-hover:bg-white">
                  {count}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mt-8">
        <p className="text-[11px] tracking-[0.16em] uppercase text-gold-deep">Quick actions</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {quick.map(({ href, label, hint, Icon }) => (
            <Link
              key={href}
              href={href}
              className="group relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-paper via-paper to-[color-mix(in_srgb,var(--gold)_12%,var(--paper))] px-4 py-4 shadow-[0_1px_0_rgba(28,28,28,0.04)] transition duration-200 hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--gold-deep)_35%,var(--line))] hover:shadow-[0_10px_28px_-18px_rgba(28,28,28,0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--gold-deep)]"
            >
              <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--gold-deep)_55%,transparent)] to-transparent opacity-0 transition group-hover:opacity-100" />
              <span className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--gold-deep)_12%,white)] text-gold-deep ring-1 ring-[color-mix(in_srgb,var(--gold-deep)_18%,transparent)] transition duration-200 group-hover:scale-105 group-hover:bg-[color-mix(in_srgb,var(--gold-deep)_18%,white)]">
                  <Icon size={18} strokeWidth={1.75} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium tracking-tight text-ink">{label}</span>
                  <span className="mt-0.5 block text-xs text-ink-soft">{hint}</span>
                </span>
              </span>
              <span className="mt-3 block text-[10px] font-medium tracking-[0.16em] uppercase text-gold-deep/80 transition group-hover:text-gold-deep">
                Open →
              </span>
            </Link>
          ))}
        </div>
      </div>
      <div className="mt-10 grid gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-4 text-lg font-medium">Recent orders</h2>
          <div className="divide-y divide-[var(--line)] border border-line">
            {orders.slice(0, 8).map((o) => (
              <Link key={o.id} href={`/admin/orders/${o.id}`} className="flex justify-between px-4 py-3 text-sm">
                <span>
                  {o.id} · {o.status} · {o.paymentStatus ?? "Success"}
                </span>
                <span>{formatINR(o.total)}</span>
              </Link>
            ))}
            {!orders.length && <p className="px-4 py-6 text-sm text-ink-soft">No orders yet.</p>}
          </div>
        </section>
        <section>
          <h2 className="mb-4 text-lg font-medium">Alerts</h2>
          <div className="space-y-3 text-sm">
            <div className="border border-line p-4">
              <p className="text-[11px] uppercase tracking-widest text-gold-deep">Low stock</p>
              {low.slice(0, 4).map((r) => (
                <p key={r.sku} className="mt-1">
                  {r.name} · {r.stock}
                </p>
              ))}
              {!low.length && <p className="mt-1 text-ink-soft">None</p>}
            </div>
            <div className="border border-line p-4">
              <p className="text-[11px] uppercase tracking-widest text-gold-deep">Upcoming visits</p>
              {upcomingVisits.slice(0, 4).map((a) => (
                <p key={a.id} className="mt-1">
                  {a.name} · {a.date} {a.time}
                </p>
              ))}
              {!upcomingVisits.length && <p className="mt-1 text-ink-soft">None</p>}
              <Link href="/admin/appointments" className="mt-2 inline-block text-xs underline">
                Open diary
              </Link>
            </div>
            <div className="border border-line p-4">
              <p className="text-[11px] uppercase tracking-widest text-gold-deep">New customers</p>
              {customers.slice(0, 4).map((c) => (
                <p key={c.id} className="mt-1">
                  {c.name}
                </p>
              ))}
              {!customers.length && <p className="mt-1 text-ink-soft">None yet</p>}
            </div>
            <div className="border border-line p-4">
              <p className="text-[11px] uppercase tracking-widest text-gold-deep">Recent reviews</p>
              {reviews.slice(0, 3).map(({ p, r }) => (
                <p key={r.id} className="mt-1">
                  {p.name}: {r.rating}/5
                </p>
              ))}
            </div>
          </div>
        </section>
      </div>
      <div className="mt-10 grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-medium">Top pieces</h2>
          <ul className="space-y-2 text-sm">
            {unitsSold.map((p) => (
              <li key={p.name}>
                {p.name} · {p.category} · {p.units} sold
              </li>
            ))}
            {!unitsSold.length && (
              <li className="text-ink-soft">No bestsellers yet — sales will appear after your first orders.</li>
            )}
          </ul>
        </div>
        <div>
          <h2 className="mb-3 text-lg font-medium">Categories & campaigns</h2>
          <p className="text-sm text-ink-soft">
            {Object.entries(catPerf)
              .map(([k, v]) => `${k} (${v})`)
              .join(" · ")}
          </p>
          <p className="mt-3 text-sm">
            {coupons.filter((c) => c.active !== false).length} active coupons · {campaigns.filter((c) => c.active).length} live promotions
          </p>
        </div>
      </div>
    </div>
  );
}
