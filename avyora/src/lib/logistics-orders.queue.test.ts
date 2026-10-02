import { describe, expect, it } from "vitest";
import {
  applyOrderStatusUpdate,
  canTransitionOrderStatus,
  codToCollect,
  nextPackStep,
  orderMatchesQueue,
} from "@/lib/logistics-orders";
import type { Order } from "@/store/shop-types";

function order(partial: Partial<Order> & Pick<Order, "status">): Order {
  return {
    id: "AVY-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    items: [],
    subtotal: 1000,
    discount: 0,
    shipping: 0,
    total: 1000,
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

describe("logistics queues", () => {
  it("keeps unpaid orders out of the packing desk", () => {
    const unpaid = order({ status: "Pending Payment", paymentStatus: "Pending" });
    const confirmed = order({ status: "Confirmed" });
    expect(orderMatchesQueue(unpaid, "pack")).toBe(false);
    expect(orderMatchesQueue(confirmed, "pack")).toBe(true);
    expect(nextPackStep(confirmed)?.status).toBe("Processing");
    expect(nextPackStep(order({ status: "Processing" }))?.status).toBe("Packed");
  });

  it("counts only uncollected COD", () => {
    expect(codToCollect(order({ status: "Packed", paymentMethod: "COD", paymentStatus: "Pending" }))).toBe(1000);
    expect(codToCollect(order({ status: "Packed", paymentMethod: "COD", paymentStatus: "Success" }))).toBe(0);
    expect(codToCollect(order({ status: "Packed", paymentMethod: "Razorpay" }))).toBe(0);
  });

  it("does not double-count shipped orders as a separate transit bucket", () => {
    const shipped = order({ status: "Shipped" });
    expect(orderMatchesQueue(shipped, "transit")).toBe(true);
    expect(orderMatchesQueue(shipped, "ofd")).toBe(false);
  });

  it("keeps refund transitions available for admin after a customer return", () => {
    expect(canTransitionOrderStatus("Return Requested", "Refunded").ok).toBe(true);
    expect(canTransitionOrderStatus("Returned", "Refunded").ok).toBe(true);
    const refunded = applyOrderStatusUpdate(
      order({ status: "Return Requested", total: 4500, returnReason: "Wrong size" }),
      "Refunded",
      { note: "Wrong size", updatedBy: "admin@avyora.test" },
    ).order;
    expect(refunded.status).toBe("Refunded");
    expect(refunded.paymentStatus).toBe("Refunded");
    expect(refunded.refundedAmount).toBe(4500);
    expect(refunded.returnReason).toBe("Wrong size");
  });
});
