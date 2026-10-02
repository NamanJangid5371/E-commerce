"use client";

import { TrendChart } from "@/components/admin/trend-chart";
import { formatINR, formatINRCompact } from "@/lib/format";
import {
  currentMonthKey,
  dailySales,
  monthLabel,
  monthRange,
  monthlySales,
} from "@/lib/monthly-analytics";
import type { Order } from "@/store/shop-types";
import { useMemo, useState } from "react";

type Mode = "monthly" | "daily";

/**
 * Sales bar chart with Monthly ↔ Daily (per day of selected month) toggle.
 */
export function SalesTrendChart({
  orders,
  subtitle = "Confirmed paid totals — excludes cancelled, refunded and unpaid",
}: {
  orders: Order[];
  subtitle?: string;
}) {
  const months = useMemo(() => monthRange(undefined, undefined, 12), []);
  const [mode, setMode] = useState<Mode>("monthly");
  const [dayMonth, setDayMonth] = useState(currentMonthKey);

  const monthlySeries = useMemo(() => monthlySales(orders, months), [orders, months]);
  const dailySeries = useMemo(() => dailySales(orders, dayMonth), [orders, dayMonth]);
  const data = mode === "monthly" ? monthlySeries : dailySeries;

  const title = mode === "monthly" ? "Monthly sales" : `Daily sales · ${monthLabel(dayMonth)}`;

  return (
    <TrendChart
      title={title}
      subtitle={subtitle}
      data={data}
      formatTick={formatINRCompact}
      formatTip={(p) => `${formatINR(p.value)} · ${p.orders ?? 0} orders`}
      variant="bar"
      color="#b33b2b"
      maxValue={10_000_000}
      headerActions={
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex border border-line text-[10px] tracking-[0.14em] uppercase"
            role="group"
            aria-label="Sales chart period"
          >
            <button
              type="button"
              onClick={() => setMode("monthly")}
              className={`px-2.5 py-1.5 transition ${
                mode === "monthly" ? "bg-ink text-ivory" : "text-ink-soft hover:text-ink"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setMode("daily")}
              className={`px-2.5 py-1.5 transition ${
                mode === "daily" ? "bg-ink text-ivory" : "text-ink-soft hover:text-ink"
              }`}
            >
              Daily
            </button>
          </div>
          {mode === "daily" ? (
            <label className="flex items-center gap-2 text-[10px] tracking-[0.12em] uppercase text-ink-soft">
              <span className="sr-only">Month</span>
              <select
                value={dayMonth}
                onChange={(e) => setDayMonth(e.target.value)}
                className="border border-line bg-transparent px-2 py-1.5 text-[11px] tracking-normal text-ink outline-none"
              >
                {[...months].reverse().map((key) => (
                  <option key={key} value={key}>
                    {monthLabel(key)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      }
    />
  );
}
