import { describe, expect, it } from "vitest";
import {
  adminCanRefundOrder,
  customerCanRequestReturn,
  customerCanReturnItem,
  customerReturnBlockedReason,
} from "@/lib/order-return";
import type { Order } from "@/store/shop-types";

function order(partial: Partial<Order> & Pick<Order, "status">): Order {
  const deliveredAt = "2026-09-20T10:00:00.000Z";
  return {
    id: "AVY-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    deliveredAt,
    items: [
      {
        orderItemId: "item_1",
        productId: "p1",
        sku: "SKU-1",
        name: "Ring",
        image: "/products/ring-1.jpg",
        quantity: 1,
        price: 5000,
        deliveredAt,
      },
    ],
    subtotal: 5000,
    discount: 0,
    shipping: 0,
    total: 5000,
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
    customerEmail: "client@example.com",
    ...partial,
  };
}

describe("order return eligibility", () => {
  it("allows customer return within 15 days of item delivery", () => {
    const o = order({ status: "Delivered" });
    expect(customerCanRequestReturn(o, "client@example.com")).toBe(true);
    expect(customerCanReturnItem(o, o.items[0], "client@example.com")).toBe(true);
  });

  it("disallows order-status-only admin refunds (RMA path required)", () => {
    expect(adminCanRefundOrder(order({ status: "Return Requested" }))).toBe(false);
    expect(adminCanRefundOrder(order({ status: "Returned" }))).toBe(false);
    expect(adminCanRefundOrder(order({ status: "RTO" }))).toBe(false);
  });

  it("blocks other customers and expired windows", () => {
    expect(customerCanRequestReturn(order({ status: "Delivered" }), "other@example.com")).toBe(false);
    const old = order({
      status: "Delivered",
      deliveredAt: "2026-01-01T00:00:00.000Z",
      items: [
        {
          orderItemId: "item_1",
          productId: "p1",
          sku: "SKU-1",
          name: "Ring",
          image: "/products/ring-1.jpg",
          quantity: 1,
          price: 5000,
          deliveredAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(customerCanRequestReturn(old, "client@example.com")).toBe(false);
    expect(customerReturnBlockedReason(old)).toMatch(/15-day/i);
  });
});
