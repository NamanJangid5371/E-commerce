import type { CommerceSnapshot } from "@/server/commerce-db";

/**
 * Transactional domains owned exclusively by PostgreSQL.
 * commerce.json / Zustand may mirror these for UI warmth, but must never be SoT.
 */
export const TRANSACTIONAL_SOT = "postgresql" as const;

export const TRANSACTIONAL_DOMAINS = [
  "orders",
  "customers",
  "payments",
  "inventory",
] as const;

export type TransactionalDomain = (typeof TRANSACTIONAL_DOMAINS)[number];

export type SotStatus = {
  sot: typeof TRANSACTIONAL_SOT;
  domains: Record<TransactionalDomain, "postgresql">;
  /** JSON → Postgres stock push (dangerous reverse sync). Default: disabled. */
  jsonStockPushToPostgresEnabled: boolean;
  /** Allow reading missing orders from commerce.json when PG has no row. Default: disabled. */
  commerceOrderFallbackEnabled: boolean;
};

/** Opt-in only. Never enabled by default — prevents Zustand/JSON stock from overwriting checkout SoT. */
export function isJsonStockPushToPostgresEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.ALLOW_JSON_STOCK_PUSH_TO_POSTGRES === "true";
}

/**
 * Opt-in ghost-order fallback. When false, logistics/dispatch only resolve orders from Postgres
 * (or DB-down errors), never from commerce.json alone.
 */
export function isCommerceOrderFallbackEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.ALLOW_COMMERCE_ORDER_FALLBACK === "true";
}

export function getSotStatus(): SotStatus {
  return {
    sot: TRANSACTIONAL_SOT,
    domains: {
      orders: "postgresql",
      customers: "postgresql",
      payments: "postgresql",
      inventory: "postgresql",
    },
    jsonStockPushToPostgresEnabled: isJsonStockPushToPostgresEnabled(),
    commerceOrderFallbackEnabled: isCommerceOrderFallbackEnabled(),
  };
}

/**
 * Strip client-supplied transactional fields from a commerce PUT payload.
 * Orders/customers always remain the server's current mirror (or empty), never the browser body.
 */
export function sanitizeCommerceWrite(
  body: Partial<CommerceSnapshot>,
  current: CommerceSnapshot,
): CommerceSnapshot {
  const { orders: _orders, customers: _customers, ...safeBody } = body;
  return {
    ...current,
    ...safeBody,
    appointments: body.appointments ?? current.appointments,
    ops: body.ops ?? current.ops,
    // Transactional SoT — never accept from client.
    orders: current.orders,
    customers: current.customers,
  };
}

/** True when the client attempted to send orders/customers that differ from server mirror. */
export function clientAttemptedTransactionalOverwrite(body: Partial<CommerceSnapshot>): boolean {
  return body.orders !== undefined || body.customers !== undefined;
}
