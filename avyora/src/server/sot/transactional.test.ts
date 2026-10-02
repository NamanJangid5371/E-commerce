import { afterEach, describe, expect, it } from "vitest";
import type { CommerceSnapshot } from "@/server/commerce-db";
import {
  clientAttemptedTransactionalOverwrite,
  getSotStatus,
  isCommerceOrderFallbackEnabled,
  isJsonStockPushToPostgresEnabled,
  sanitizeCommerceWrite,
  TRANSACTIONAL_SOT,
} from "@/server/sot/transactional";

const ENV_KEYS = ["ALLOW_JSON_STOCK_PUSH_TO_POSTGRES", "ALLOW_COMMERCE_ORDER_FALLBACK", "NODE_ENV"] as const;
const envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = envSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function stubSnapshot(overrides?: Partial<CommerceSnapshot>): CommerceSnapshot {
  return {
    catalog: [],
    collections: [],
    coupons: [],
    customers: [
      {
        id: "cust-server",
        name: "Server Customer",
        email: "server@avyora.com",
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "active",
        addresses: [],
      },
    ],
    orders: [
      {
        id: "ORD-SERVER",
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "Confirmed",
        items: [],
        subtotal: 100,
        discount: 0,
        shipping: 0,
        total: 100,
        address: {
          name: "A",
          phone: "1",
          line1: "x",
          city: "y",
          state: "z",
          pincode: "560001",
        },
      },
    ],
    campaigns: [],
    mediaUrls: [],
    audit: [],
    appointments: [],
    ops: {} as CommerceSnapshot["ops"],
    ...overrides,
  } as CommerceSnapshot;
}

describe("PostgreSQL transactional SoT", () => {
  it("declares postgresql as SoT for orders/customers/payments/inventory", () => {
    const status = getSotStatus();
    expect(status.sot).toBe(TRANSACTIONAL_SOT);
    expect(status.domains.orders).toBe("postgresql");
    expect(status.domains.customers).toBe("postgresql");
    expect(status.domains.payments).toBe("postgresql");
    expect(status.domains.inventory).toBe("postgresql");
  });

  it("disables JSON→Postgres stock push by default", () => {
    delete process.env.ALLOW_JSON_STOCK_PUSH_TO_POSTGRES;
    expect(isJsonStockPushToPostgresEnabled()).toBe(false);
  });

  it("disables commerce.json order fallback by default", () => {
    delete process.env.ALLOW_COMMERCE_ORDER_FALLBACK;
    expect(isCommerceOrderFallbackEnabled()).toBe(false);
  });

  it("never applies client orders/customers on commerce write sanitize", () => {
    const current = stubSnapshot();
    const body: Partial<CommerceSnapshot> = {
      catalog: [{ id: "p1" } as CommerceSnapshot["catalog"][number]],
      orders: [
        {
          ...current.orders[0],
          id: "ORD-CLIENT-FAKE",
          total: 999999,
        },
      ],
      customers: [
        {
          id: "cust-client",
          name: "Hacked",
          email: "hacked@example.com",
          createdAt: "2026-01-02T00:00:00.000Z",
          status: "active",
          addresses: [],
        },
      ],
    };

    expect(clientAttemptedTransactionalOverwrite(body)).toBe(true);

    const next = sanitizeCommerceWrite(body, current);
    expect(next.orders).toEqual(current.orders);
    expect(next.orders.some((o) => o.id === "ORD-CLIENT-FAKE")).toBe(false);
    expect(next.customers).toEqual(current.customers);
    expect(next.customers.some((c) => c.email === "hacked@example.com")).toBe(false);
    expect(next.catalog).toEqual(body.catalog);
  });

  it("forces stock-push and order-fallback off in production even if env is set", () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_JSON_STOCK_PUSH_TO_POSTGRES = "true";
    process.env.ALLOW_COMMERCE_ORDER_FALLBACK = "true";
    expect(isJsonStockPushToPostgresEnabled()).toBe(false);
    expect(isCommerceOrderFallbackEnabled()).toBe(false);
  });
});
