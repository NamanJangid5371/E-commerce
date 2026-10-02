import type { SiteVisit } from "@/data/admin-ops";
import { isRecognizedSale, saleAmount } from "@/lib/sales";
import type { Order } from "@/store/shop-types";

export type MonthPoint = {
  key: string;
  label: string;
  value: number;
  orders?: number;
};

const MONTH_LABEL = new Intl.DateTimeFormat("en-IN", { month: "short" });
const DAY_MONTH_LABEL = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

export function monthKey(iso: string) {
  return iso.slice(0, 7);
}

export function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_LABEL.format(new Date(y, m - 1, 1))} ${String(y).slice(2)}`;
}

function shiftMonth(key: string, delta: number) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Most recent September on or before `endKey` (YYYY-MM). */
export function septemberStart(endKey: string): string {
  const [y, m] = endKey.split("-").map(Number);
  if (!y || !m) return endKey;
  return m >= 9 ? `${y}-09` : `${y - 1}-09`;
}

export function monthRange(from?: string, to?: string, months = 12): string[] {
  const keys: string[] = [];
  const now = new Date();
  const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let start: string;
  let end: string;
  if (from) {
    start = from.slice(0, 7);
    end = to ? to.slice(0, 7) : nowKey;
  } else if (to) {
    end = to.slice(0, 7);
    start = septemberStart(end);
  } else {
    // Open range: September → full 12-month year (not only the current month).
    start = septemberStart(nowKey);
    end = shiftMonth(start, months - 1);
  }
  let cur = start;
  while (cur <= end) {
    keys.push(cur);
    cur = shiftMonth(cur, 1);
    if (keys.length > Math.max(months, 24)) break;
  }
  return keys;
}

export function currentMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** ISO date keys (YYYY-MM-DD) for every day in a calendar month. */
export function dayKeysForMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return [];
  const daysInMonth = new Date(y, m, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    return `${month}-${String(day).padStart(2, "0")}`;
  });
}

export function dayLabel(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return DAY_MONTH_LABEL.format(new Date(y, m - 1, d));
}

export function monthlySales(orders: Order[], months: string[]): MonthPoint[] {
  const byMonth = new Map<string, { value: number; orders: number }>();
  for (const key of months) byMonth.set(key, { value: 0, orders: 0 });
  for (const order of orders) {
    if (!isRecognizedSale(order)) continue;
    const amount = saleAmount(order);
    if (amount <= 0) continue;
    const key = monthKey(order.createdAt);
    const bucket = byMonth.get(key);
    if (!bucket) continue;
    bucket.value += amount;
    bucket.orders += 1;
  }
  return months.map((key) => {
    const bucket = byMonth.get(key) ?? { value: 0, orders: 0 };
    return { key, label: monthLabel(key), value: bucket.value, orders: bucket.orders };
  });
}

/** Confirmed paid sales totals for each day of the given YYYY-MM month. */
export function dailySales(orders: Order[], month: string): MonthPoint[] {
  const days = dayKeysForMonth(month);
  const byDay = new Map<string, { value: number; orders: number }>();
  for (const key of days) byDay.set(key, { value: 0, orders: 0 });
  for (const order of orders) {
    if (!isRecognizedSale(order)) continue;
    const amount = saleAmount(order);
    if (amount <= 0) continue;
    const key = order.createdAt.slice(0, 10);
    const bucket = byDay.get(key);
    if (!bucket) continue;
    bucket.value += amount;
    bucket.orders += 1;
  }
  return days.map((key) => {
    const bucket = byDay.get(key) ?? { value: 0, orders: 0 };
    return {
      key,
      label: dayLabel(key),
      value: bucket.value,
      orders: bucket.orders,
    };
  });
}

export function monthlyVisits(visits: SiteVisit[] | undefined, months: string[]): MonthPoint[] {
  const byMonth = new Map<string, number>();
  for (const key of months) byMonth.set(key, 0);
  for (const row of visits ?? []) {
    const key = monthKey(row.date);
    if (!byMonth.has(key)) continue;
    byMonth.set(key, (byMonth.get(key) ?? 0) + row.count);
  }
  return months.map((key) => ({
    key,
    label: monthLabel(key),
    value: byMonth.get(key) ?? 0,
  }));
}
