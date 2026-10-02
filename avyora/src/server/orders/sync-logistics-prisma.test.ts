import { describe, expect, it } from "vitest";
import {
  logisticsRestockReason,
  shouldRestockOnLogisticsTransition,
  toPrismaOrderStatus,
} from "@/server/orders/sync-logistics-prisma";
import type { OrderStatus } from "@/store/shop-types";

describe("toPrismaOrderStatus", () => {
  it("maps core and exception logistics statuses", () => {
    const cases: Array<[OrderStatus, string]> = [
      ["Confirmed", "CONFIRMED"],
      ["In Transit", "IN_TRANSIT"],
      ["Failed Delivery", "FAILED_DELIVERY"],
      ["Return Pickup", "RETURN_PICKUP"],
      ["RTO", "RTO"],
      ["Delivered", "DELIVERED"],
      ["Cancelled", "CANCELLED"],
    ];
    for (const [status, expected] of cases) {
      expect(toPrismaOrderStatus(status)).toBe(expected);
    }
  });
});

describe("logistics cancel/return restock guards", () => {
  it("restocks once when transitioning into Cancelled", () => {
    expect(shouldRestockOnLogisticsTransition("PACKED", "CANCELLED")).toBe(true);
    expect(logisticsRestockReason("CANCELLED")).toBe("logistics_cancel_restock");
  });

  it("restocks for Returned and RTO", () => {
    expect(shouldRestockOnLogisticsTransition("DELIVERED", "RETURNED")).toBe(true);
    expect(shouldRestockOnLogisticsTransition("SHIPPED", "RTO")).toBe(true);
    expect(logisticsRestockReason("RETURNED")).toBe("logistics_return_restock");
    expect(logisticsRestockReason("RTO")).toBe("logistics_rto_restock");
  });

  it("does not restock terminal or no-op transitions", () => {
    expect(shouldRestockOnLogisticsTransition("CANCELLED", "CANCELLED")).toBe(false);
    expect(shouldRestockOnLogisticsTransition("CANCELLED", "RETURNED")).toBe(false);
    expect(shouldRestockOnLogisticsTransition("REFUNDED", "CANCELLED")).toBe(false);
    expect(shouldRestockOnLogisticsTransition("RETURNED", "RTO")).toBe(false);
    expect(shouldRestockOnLogisticsTransition("PACKED", "SHIPPED")).toBe(false);
  });
});
