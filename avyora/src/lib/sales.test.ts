import { describe, expect, it } from "vitest";
import { isRecognizedSale, saleAmount, sumSales, todaySalesOrders } from "@/lib/sales";
import type { Order } from "@/store/shop-types";

function order(partial: Partial<Order> & Pick<Order, "status" | "total">): Order {
  return {
    id: "o1",
    createdAt: new Date().toISOString(),
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
    ...partial,
  };
}

describe("sales recognition", () => {
  it("excludes cancelled orders", () => {
    expect(isRecognizedSale(order({ status: "Cancelled", total: 1000, paymentStatus: "Cancelled" }))).toBe(false);
    expect(saleAmount(order({ status: "Cancelled", total: 143700, paymentStatus: "Cancelled" }))).toBe(0);
  });

  it("nets full refunds to zero revenue", () => {
    expect(
      saleAmount(order({ status: "Refunded", total: 1000, paymentStatus: "Refunded", refundedAmount: 1000 })),
    ).toBe(0);
    expect(saleAmount(order({ status: "Refunded", total: 1000, paymentStatus: "Refunded" }))).toBe(0);
  });

  it("excludes pending payment", () => {
    expect(isRecognizedSale(order({ status: "Pending Payment", total: 5000, paymentStatus: "Pending" }))).toBe(false);
  });

  it("counts COD confirmed orders with pending cash collection", () => {
    const o = order({
      status: "Confirmed",
      total: 87035,
      paymentStatus: "Pending",
      paymentMethod: "cod",
    });
    expect(isRecognizedSale(o)).toBe(true);
    expect(saleAmount(o)).toBe(87035);
  });

  it("counts confirmed paid orders", () => {
    const o = order({ status: "Confirmed", total: 8900, paymentStatus: "Success" });
    expect(isRecognizedSale(o)).toBe(true);
    expect(saleAmount(o)).toBe(8900);
  });

  it("subtracts partial refunds from sale amount", () => {
    expect(
      saleAmount(order({ status: "Delivered", total: 10000, paymentStatus: "Success", refundedAmount: 2500 })),
    ).toBe(7500);
  });

  it("subtracts refunded amount from total revenue across orders", () => {
    const list = [
      order({ status: "Delivered", total: 10000, paymentStatus: "Success" }),
      order({
        id: "o2",
        status: "Delivered",
        total: 8000,
        paymentStatus: "Success",
        refundedAmount: 3000,
      }),
      order({
        id: "o3",
        status: "Refunded",
        total: 5000,
        paymentStatus: "Refunded",
        refundedAmount: 5000,
      }),
    ];
    expect(sumSales(list)).toBe(15000); // 10000 + 5000 + 0
  });

  it("today sales ignores cancelled same-day orders", () => {
    const list = [
      order({ status: "Cancelled", total: 143700, paymentStatus: "Cancelled" }),
      order({ status: "Confirmed", total: 5000, paymentStatus: "Success" }),
    ];
    const today = todaySalesOrders(list);
    expect(today).toHaveLength(1);
    expect(today[0].total).toBe(5000);
  });
});
