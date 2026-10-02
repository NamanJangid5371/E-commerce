import { describe, expect, it, vi } from "vitest";
import {
  aggregateStockDemand,
  confirmReasonTag,
  holdInventoryForOrder,
  InsufficientStockError,
  releaseInventoryHoldForOrder,
  releaseReasonTag,
  reserveReasonTag,
  confirmInventoryHoldForOrder,
} from "@/server/inventory/reservation";

describe("reservation tags", () => {
  it("builds stable per-order reason tags", () => {
    expect(reserveReasonTag("o1")).toBe("order_reserved:o1");
    expect(confirmReasonTag("o1")).toBe("order_confirmed:o1");
    expect(releaseReasonTag("o1")).toBe("order_release:o1");
  });
});

describe("aggregateStockDemand", () => {
  it("aggregates and sorts for lock order", () => {
    const demand = aggregateStockDemand([
      { variantId: "var-b", quantity: 1 },
      { variantId: "var-a", quantity: 2 },
      { variantId: "var-a", quantity: 3 },
    ]);
    expect(demand.map((d) => d.variantId)).toEqual(["var-a", "var-b"]);
    expect(demand[0].quantity).toBe(5);
  });
});

function mockReservationTx(opts: {
  stock: number;
  quantity: number;
  reserved: number;
  priorReasons?: string[];
}) {
  const state = {
    stock: opts.stock,
    quantity: opts.quantity,
    reserved: opts.reserved,
    inventoryId: "inv-1",
    productId: "prod-1",
    movements: [] as Array<{ reason: string; delta: number }>,
  };
  const prior = new Set(opts.priorReasons ?? []);

  const tx = {
    stockMovement: {
      findFirst: vi.fn(async ({ where }: { where: { reason: string | { in: string[] } } }) => {
        const reasons =
          typeof where.reason === "string" ? [where.reason] : where.reason.in;
        const hit = reasons.find((r) => prior.has(r) || state.movements.some((m) => m.reason === r));
        return hit ? { id: "m1" } : null;
      }),
      create: vi.fn(async ({ data }: { data: { reason: string; delta: number } }) => {
        state.movements.push({ reason: data.reason, delta: data.delta });
        return data;
      }),
    },
    warehouse: {
      findFirst: vi.fn(async () => ({ id: "wh-1" })),
      create: vi.fn(),
    },
    inventory: {
      findFirst: vi.fn(async () => ({
        id: state.inventoryId,
        quantity: state.quantity,
        reserved: state.reserved,
      })),
      create: vi.fn(),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (typeof data.reserved === "number") state.reserved = data.reserved;
        if (data.reserved && typeof data.reserved === "object" && "increment" in data.reserved) {
          state.reserved += Number((data.reserved as { increment: number }).increment);
        }
        if (typeof data.quantity === "number") state.quantity = data.quantity;
        if (data.quantity && typeof data.quantity === "object" && "decrement" in data.quantity) {
          state.quantity -= Number((data.quantity as { decrement: number }).decrement);
        }
        if (data.quantity && typeof data.quantity === "object" && "increment" in data.quantity) {
          state.quantity += Number((data.quantity as { increment: number }).increment);
        }
        return {};
      }),
      updateMany: vi.fn(async ({ where, data }: {
        where: { id: string; quantity: { gte: number } };
        data: { reserved: { increment: number } };
      }) => {
        if (state.quantity < where.quantity.gte) return { count: 0 };
        state.reserved += data.reserved.increment;
        return { count: 1 };
      }),
    },
    productVariant: {
      updateMany: vi.fn(async ({ where, data }: {
        where: { stock: { gte: number } };
        data: { stock: { decrement: number } };
      }) => {
        if (state.stock < where.stock.gte) return { count: 0 };
        state.stock -= data.stock.decrement;
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: { stock: { increment?: number; decrement?: number } } }) => {
        if (data.stock.increment) state.stock += data.stock.increment;
        if (data.stock.decrement) state.stock -= data.stock.decrement;
        return {};
      }),
    },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("product_variants")) {
        return [
          {
            id: "var-a",
            sku: "SKU-A",
            stock: state.stock,
            productId: state.productId,
            product_name: "Ring",
          },
        ];
      }
      // inventory lock
      return [
        {
          id: state.inventoryId,
          quantity: state.quantity,
          reserved: state.reserved,
        },
      ];
    }),
  };

  return { tx: tx as never, state };
}

describe("hold → confirm → lifecycle", () => {
  it("soft-holds: decreases sellable stock, increases reserved, leaves on-hand", async () => {
    const { tx, state } = mockReservationTx({ stock: 5, quantity: 5, reserved: 0 });

    await holdInventoryForOrder(tx, "ord-1", [{ variantId: "var-a", quantity: 2 }], "a@b.com");

    expect(state.stock).toBe(3);
    expect(state.quantity).toBe(5);
    expect(state.reserved).toBe(2);
    expect(state.movements[0]).toMatchObject({
      reason: "order_reserved:ord-1",
      delta: 0,
    });
  });

  it("confirm: decreases on-hand and reserved; sellable unchanged", async () => {
    const { tx, state } = mockReservationTx({ stock: 3, quantity: 5, reserved: 2 });
    state.movements.push({ reason: "order_reserved:ord-1", delta: 0 });

    await confirmInventoryHoldForOrder(tx, "ord-1", [{ variantId: "var-a", quantity: 2 }]);

    expect(state.stock).toBe(3);
    expect(state.quantity).toBe(3);
    expect(state.reserved).toBe(0);
    expect(state.movements.some((m) => m.reason === "order_confirmed:ord-1" && m.delta === -2)).toBe(
      true,
    );
  });

  it("release: restores sellable, clears reserved, leaves on-hand", async () => {
    const { tx, state } = mockReservationTx({ stock: 3, quantity: 5, reserved: 2 });
    state.movements.push({ reason: "order_reserved:ord-1", delta: 0 });

    const outcome = await releaseInventoryHoldForOrder(tx, "ord-1", [
      { variantId: "var-a", quantity: 2 },
    ]);

    expect(outcome).toBe("released");
    expect(state.stock).toBe(5);
    expect(state.quantity).toBe(5);
    expect(state.reserved).toBe(0);
  });

  it("rejects hold when available stock is insufficient", async () => {
    const { tx } = mockReservationTx({ stock: 1, quantity: 1, reserved: 0 });
    await expect(
      holdInventoryForOrder(tx, "ord-x", [{ variantId: "var-a", quantity: 2 }]),
    ).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it("is idempotent on repeated hold for the same order", async () => {
    const { tx, state } = mockReservationTx({
      stock: 5,
      quantity: 5,
      reserved: 0,
      priorReasons: ["order_reserved:ord-1"],
    });

    await holdInventoryForOrder(tx, "ord-1", [{ variantId: "var-a", quantity: 2 }]);
    expect(state.stock).toBe(5);
    expect(state.reserved).toBe(0);
  });
});
