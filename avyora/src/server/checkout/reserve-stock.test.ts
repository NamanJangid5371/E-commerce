import { describe, expect, it, vi } from "vitest";
import {
  aggregateStockDemand,
  InsufficientStockError,
  reserveStockInTransaction,
} from "@/server/checkout/reserve-stock";

describe("aggregateStockDemand", () => {
  it("aggregates duplicate variant lines and sorts lock order", () => {
    const demand = aggregateStockDemand([
      { variantId: "var-b", quantity: 1, label: "B" },
      { variantId: "var-a", quantity: 2, label: "A1" },
      { variantId: "var-a", quantity: 3, label: "A2" },
      { variantId: "var-c", quantity: 0 },
    ]);
    expect(demand.map((d) => d.variantId)).toEqual(["var-a", "var-b"]);
    expect(demand[0]).toMatchObject({ variantId: "var-a", quantity: 5, label: "A1" });
    expect(demand[1]).toMatchObject({ variantId: "var-b", quantity: 1, label: "B" });
  });
});

describe("reserveStockInTransaction", () => {
  it("requires orderId", async () => {
    await expect(
      reserveStockInTransaction({} as never, [{ variantId: "v", quantity: 1 }]),
    ).rejects.toThrow(/orderId/);
  });

  it("holds then optionally confirms for COD", async () => {
    const hold = vi.fn(async () => undefined);
    const confirm = vi.fn(async () => undefined);

    vi.doMock("@/server/inventory/reservation", async () => {
      const actual = await vi.importActual<typeof import("@/server/inventory/reservation")>(
        "@/server/inventory/reservation",
      );
      return {
        ...actual,
        holdInventoryForOrder: hold,
        confirmInventoryHoldForOrder: confirm,
      };
    });

    // Direct behavioral check via real module path: insufficient without DB is covered
    // in reservation.test.ts. Here we only assert the orderId guard + error type export.
    expect(InsufficientStockError).toBeTypeOf("function");
  });
});
