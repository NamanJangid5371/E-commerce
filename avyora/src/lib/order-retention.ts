import type { Order } from "@/store/shop-types";

/**
 * Cancelled-order purge is OFF by default so shutting servers never drops history.
 * Set CANCELLED_ORDER_RETENTION_HOURS to a positive number to enable (e.g. 24).
 */
function retentionMs() {
  const raw = process.env.CANCELLED_ORDER_RETENTION_HOURS;
  if (raw == null || raw.trim() === "" || raw.trim() === "0") return null;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return hours * 60 * 60 * 1000;
}

function cancelledAt(order: Order) {
  const cancelEvent = order.trackingEvents?.find((event) => event.status === "Cancelled")?.at;
  return cancelEvent ?? order.lastUpdatedAt ?? order.createdAt;
}

export function shouldDeleteCancelledOrder(order: Order, now = Date.now()) {
  const windowMs = retentionMs();
  if (windowMs == null) return false;
  if (order.status !== "Cancelled") return false;
  const at = Date.parse(cancelledAt(order));
  if (Number.isNaN(at)) return false;
  return now - at >= windowMs;
}

export function filterRetainedOrders(orders: Order[] | undefined, now = Date.now()) {
  return (orders ?? []).filter((order) => !shouldDeleteCancelledOrder(order, now));
}
