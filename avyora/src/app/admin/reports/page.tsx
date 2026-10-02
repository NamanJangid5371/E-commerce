"use client";

import { SalesTrendChart } from "@/components/admin/sales-trend-chart";
import { TrendChart } from "@/components/admin/trend-chart";
import { variantStock } from "@/data/catalog";
import { formatCount, formatINR } from "@/lib/format";
import { monthRange, monthlySales, monthlyVisits } from "@/lib/monthly-analytics";
import { filterSales, sumSales } from "@/lib/sales";
import { useShopStore } from "@/store/shop-store";
import { useMemo, useState } from "react";

function download(name: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsAdmin() {
  const catalog = useShopStore((s) => s.catalog);
  const orders = useShopStore((s) => s.orders);
  const customers = useShopStore((s) => s.customers);
  const coupons = useShopStore((s) => s.coupons);
  const visits = useShopStore((s) => s.ops?.visits);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const d = o.createdAt.slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [orders, from, to]);

  const months = useMemo(() => monthRange(from, to, 12), [from, to]);
  const salesSeries = useMemo(() => monthlySales(filtered, months), [filtered, months]);
  const visitSeries = useMemo(() => monthlyVisits(visits, months), [visits, months]);

  const recognized = useMemo(() => filterSales(filtered), [filtered]);
  const revenue = sumSales(filtered);
  const refunds = filtered
    .filter((o) => o.status === "Refunded" || o.paymentStatus === "Refunded")
    .reduce((s, o) => s + (o.refundedAmount ?? o.total), 0);
  const visitTotal = visitSeries.reduce((s, p) => s + p.value, 0);

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Reports & analytics</h1>
      <p className="mt-1 text-sm text-ink-soft">Monthly sales and storefront visits, plus date-filtered orders, inventory, coupons and refunds.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-line bg-transparent px-3 py-2 text-sm" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-line bg-transparent px-3 py-2 text-sm" />
        <button
          className="border border-line px-4 py-2 text-xs uppercase tracking-widest"
          onClick={() =>
            download("avyora-orders.csv", [
              ["id", "date", "status", "payment", "total"],
              ...filtered.map((o) => [o.id, o.createdAt, o.status, o.paymentStatus ?? "", String(o.total)]),
            ])
          }
        >
          Export orders CSV
        </button>
        <button
          className="border border-line px-4 py-2 text-xs uppercase tracking-widest"
          onClick={() =>
            download("avyora-monthly.csv", [
              ["month", "sales", "orders", "visits"],
              ...salesSeries.map((s, i) => [s.label, String(s.value), String(s.orders ?? 0), String(visitSeries[i]?.value ?? 0)]),
            ])
          }
        >
          Export monthly CSV
        </button>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-5">
        {[
          ["Revenue", formatINR(revenue)],
          ["Paid orders", String(recognized.length)],
          ["Refunds", formatINR(refunds)],
          ["Customers", String(customers.length)],
          ["Site visits", formatCount(visitTotal)],
        ].map(([k, v]) => (
          <div key={k} className="border border-line p-4">
            <p className="text-[11px] uppercase tracking-widest text-gold-deep">{k}</p>
            <p className="mt-2 text-2xl font-medium">{v}</p>
          </div>
        ))}
      </div>
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <SalesTrendChart
          orders={filtered}
          subtitle="Paid order totals, excluding cancelled and refunded"
        />
        <TrendChart
          title="Monthly site visits"
          subtitle="Storefront sessions counted once per browser per day"
          data={visitSeries}
          formatTick={formatCount}
          formatTip={(p) => `${formatCount(p.value)} visits`}
          variant="area"
          color="#1c1c1c"
        />
      </div>
      <div className="mt-6 overflow-x-auto border border-line">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-[11px] uppercase tracking-widest text-gold-deep">
            <tr>
              <th className="px-4 py-3 font-medium">Month</th>
              <th className="px-4 py-3 font-medium">Sales</th>
              <th className="px-4 py-3 font-medium">Orders</th>
              <th className="px-4 py-3 font-medium">Visits</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {salesSeries.map((row, i) => (
              <tr key={row.key}>
                <td className="px-4 py-2.5">{row.label}</td>
                <td className="px-4 py-2.5">{formatINR(row.value)}</td>
                <td className="px-4 py-2.5">{row.orders ?? 0}</td>
                <td className="px-4 py-2.5">{formatCount(visitSeries[i]?.value ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="mt-10 text-lg font-medium">Inventory</h2>
      <p className="text-sm text-ink-soft">
        {catalog.filter((p) => variantStock(p) === 0).length} out of stock · {catalog.filter((p) => variantStock(p) <= 3).length} low stock
      </p>
      <h2 className="mt-8 text-lg font-medium">Coupon usage</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {coupons.map((c) => (
          <li key={c.code}>
            {c.code}: {c.usageCount ?? 0} uses
          </li>
        ))}
      </ul>
      <h2 className="mt-8 text-lg font-medium">Category mix</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {Object.entries(
          catalog.reduce<Record<string, number>>((acc, p) => {
            acc[p.category] = (acc[p.category] ?? 0) + 1;
            return acc;
          }, {}),
        ).map(([k, v]) => (
          <li key={k}>
            {k}: {v} SKUs
          </li>
        ))}
      </ul>
    </div>
  );
}
