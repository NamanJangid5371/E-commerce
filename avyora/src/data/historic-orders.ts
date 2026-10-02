/**
 * Historic demo orders (AVH-*) were used to populate dashboard charts.
 * They are no longer injected — Avyora starts as a new business with zero sales.
 * Kept as an empty export so any leftover imports do not break builds.
 */
import type { Order } from "@/store/shop-types";

export function seedHistoricOrders(_now = new Date()): Order[] {
  return [];
}
