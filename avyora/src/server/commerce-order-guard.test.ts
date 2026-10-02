import { describe, expect, it } from "vitest";
import { mergeOrdersPreservingLogistics } from "@/server/commerce-order-guard";
import { patchLogisticsOrder } from "@/server/logistics/mutations";
import type { Order } from "@/store/shop-types";

function baseOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "ORD-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "Shipped",
    total: 5000,
    items: [],
    address: {
      name: "Asha",
      phone: "9999999999",
      line1: "1 Main",
      city: "Mumbai",
      state: "MH",
      pincode: "400001",
    },
    paymentMethod: "COD",
    paymentStatus: "Pending",
    trackingId: "TRACK-SERVER",
    deliveryPartner: "BlueDart",
    shipmentId: "SHIP-1",
    trackingEvents: [{ at: "2026-01-01T00:00:00.000Z", title: "Packed", status: "Packed" }],
    deliveryAttempts: [],
    ...overrides,
  } as Order;
}

describe("mergeOrdersPreservingLogistics", () => {
  it("preserves shipment and COD payment fields from admin PUT", () => {
    const current = [baseOrder()];
    const incoming = [
      baseOrder({
        trackingId: "HACKED",
        deliveryPartner: "EvilCourier",
        shipmentId: "X",
        paymentStatus: "Success",
        status: "Delivered",
        trackingEvents: [],
        notes: "admin note",
      }),
    ];

    const merged = mergeOrdersPreservingLogistics(current, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].trackingId).toBe("TRACK-SERVER");
    expect(merged[0].deliveryPartner).toBe("BlueDart");
    expect(merged[0].shipmentId).toBe("SHIP-1");
    expect(merged[0].paymentStatus).toBe("Pending");
    expect(merged[0].status).toBe("Shipped");
    expect(merged[0].notes).toBe("admin note");
    expect(merged[0].trackingEvents).toHaveLength(1);
  });

  it("allows admin cancel/refund and return reject", () => {
    const current = [baseOrder({ status: "Return Requested", paymentStatus: "Success", paymentMethod: "Razorpay" })];
    const reject = mergeOrdersPreservingLogistics(current, [
      baseOrder({
        status: "Delivered",
        paymentStatus: "Success",
        paymentMethod: "Razorpay",
        trackingId: "SHOULD-KEEP-SERVER",
      }),
    ]);
    expect(reject[0].status).toBe("Delivered");
    expect(reject[0].trackingId).toBe("TRACK-SERVER");

    const cancel = mergeOrdersPreservingLogistics(
      [baseOrder()],
      [baseOrder({ status: "Cancelled", paymentStatus: "Cancelled", cancelReason: "fraud" })],
    );
    expect(cancel[0].status).toBe("Cancelled");
    expect(cancel[0].paymentStatus).toBe("Cancelled");
    expect(cancel[0].cancelReason).toBe("fraud");
  });
});

describe("patchLogisticsOrder COD", () => {
  it("rejects collectCod shortcut — cash/UPI must go through COD verification API", () => {
    const result = patchLogisticsOrder(baseOrder(), {
      collectCod: true,
      updatedBy: "ops@avyora.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/OTP|cash|UPI/i);
    }
  });

  it("does not auto-mark COD paid when marking Delivered", () => {
    const result = patchLogisticsOrder(baseOrder({ status: "Out for Delivery" }), {
      status: "Delivered",
      updatedBy: "ops@avyora.com",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order.paymentStatus).toBe("Pending");
  });

  it("rejects direct paymentStatus Success for COD", () => {
    const result = patchLogisticsOrder(baseOrder(), {
      paymentStatus: "Success",
      updatedBy: "ops@avyora.com",
    });
    expect(result.ok).toBe(false);
  });
});
