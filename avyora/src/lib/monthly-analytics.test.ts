import { describe, expect, it } from "vitest";
import { dailySales, dayKeysForMonth, monthRange, monthlySales, septemberStart } from "@/lib/monthly-analytics";
import type { Order } from "@/store/shop-types";

function order(partial: Partial<Order> & Pick<Order, "createdAt" | "total" | "status">): Order {
  return {
    id: "o1",
    items: [],
    subtotal: partial.total,
    discount: 0,
    shipping: 0,
    address: {
      id: "a1",
      name: "Test",
      phone: "9999999999",
      line1: "1",
      city: "Bengaluru",
      state: "KA",
      pincode: "560001",
    },
    paymentId: "pay_1",
    paymentStatus: "Success",
    ...partial,
  };
}

describe("dailySales", () => {
  it("builds one bucket per calendar day", () => {
    expect(dayKeysForMonth("2026-09")).toHaveLength(30);
    expect(dayKeysForMonth("2026-02")).toHaveLength(28);
  });

  it("aggregates recognized sales by day", () => {
    const orders = [
      order({ createdAt: "2026-09-16T10:00:00.000Z", total: 1000, status: "Confirmed" }),
      order({ createdAt: "2026-09-16T18:00:00.000Z", total: 500, status: "Delivered" }),
      order({ createdAt: "2026-09-01T12:00:00.000Z", total: 200, status: "Cancelled" }),
      order({ createdAt: "2026-08-31T12:00:00.000Z", total: 9000, status: "Confirmed" }),
    ];
    const series = dailySales(orders, "2026-09");
    expect(series).toHaveLength(30);
    const day16 = series.find((p) => p.key === "2026-09-16");
    expect(day16?.value).toBe(1500);
    expect(day16?.orders).toBe(2);
    expect(series.find((p) => p.key === "2026-09-01")?.value).toBe(0);
  });

  it("monthlySales still aggregates by month", () => {
    const orders = [
      order({ createdAt: "2026-09-16T10:00:00.000Z", total: 1000, status: "Confirmed" }),
    ];
    const series = monthlySales(orders, ["2026-08", "2026-09"]);
    expect(series[1]?.value).toBe(1000);
    expect(series[0]?.value).toBe(0);
  });
});

describe("monthRange", () => {
  it("starts an open range from September through a full year", () => {
    expect(septemberStart("2026-09")).toBe("2026-09");
    expect(septemberStart("2026-12")).toBe("2026-09");
    expect(septemberStart("2026-08")).toBe("2025-09");
    const open = monthRange();
    expect(open[0]).toMatch(/-09$/);
    expect(open).toHaveLength(12);
    expect(open.at(-1)).toBe(open[0]?.replace(/-09$/, "-08").replace(/^(\d{4})/, (_, y) => String(Number(y) + 1)));
  });

  it("with only a to date, still starts from September", () => {
    expect(monthRange(undefined, "2026-09")).toEqual(["2026-09"]);
    expect(monthRange(undefined, "2026-10")).toEqual(["2026-09", "2026-10"]);
    expect(monthRange(undefined, "2026-08")[0]).toBe("2025-09");
    expect(monthRange(undefined, "2026-08").at(-1)).toBe("2026-08");
  });

  it("honors an explicit from date", () => {
    expect(monthRange("2026-01", "2026-03")).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
});
