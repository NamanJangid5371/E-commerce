import { RETURN_WINDOW_DAYS, isWithinReturnWindow, returnWindowDeadline } from "@/lib/return-window";
import type { Order } from "@/store/shop-types";

export { RETURN_WINDOW_DAYS, isWithinReturnWindow, returnWindowDeadline };

const RETURN_FLOW_STATUSES = new Set([
  "Return Requested",
  "Return Pickup",
  "Returned",
  "Refunded",
  "RTO",
]);

function itemDeliveredAt(order: Order, item: Order["items"][number]): Date | null {
  const raw = item.deliveredAt || order.deliveredAt;
  if (raw) return new Date(raw);
  const fromEvents = order.trackingEvents?.find((e) => e.status === "Delivered")?.at;
  return fromEvents ? new Date(fromEvents) : null;
}

/** Customer may request a return for a delivered line item within 15 days of delivery. */
export function customerCanRequestReturn(order: Order, customerEmail?: string | null): boolean {
  if (customerEmail) {
    const owned = (order.customerEmail ?? "").toLowerCase() === customerEmail.toLowerCase();
    if (!owned) return false;
  }
  if ((order.paymentStatus ?? "Success") === "Failed" || order.paymentStatus === "Cancelled") {
    return false;
  }
  if (order.status === "Cancelled") return false;
  return order.items.some((item) => {
    const deliveredAt = itemDeliveredAt(order, item);
    return Boolean(deliveredAt && isWithinReturnWindow(deliveredAt));
  });
}

export function customerCanReturnItem(
  order: Order,
  item: Order["items"][number],
  customerEmail?: string | null,
): boolean {
  if (customerEmail) {
    const owned = (order.customerEmail ?? "").toLowerCase() === customerEmail.toLowerCase();
    if (!owned) return false;
  }
  if (!item.orderItemId) return false;
  if (order.status === "Cancelled") return false;
  const deliveredAt = itemDeliveredAt(order, item);
  return Boolean(deliveredAt && isWithinReturnWindow(deliveredAt));
}

export function customerReturnBlockedReason(order: Order): string {
  if (order.status === "Refunded") {
    return "This order has already been refunded.";
  }
  if (order.status === "Cancelled") {
    return "Cancelled orders cannot be returned.";
  }
  const anyDelivered = order.items.some((item) => itemDeliveredAt(order, item));
  if (!anyDelivered) {
    return "Returns can only be requested after the order is delivered.";
  }
  const stillOpen = order.items.some((item) => {
    const d = itemDeliveredAt(order, item);
    return d && isWithinReturnWindow(d);
  });
  if (!stillOpen) {
    return `The ${RETURN_WINDOW_DAYS}-day return window from delivery has closed.`;
  }
  return "This order cannot be returned.";
}

export function isReturnOrRefundStatus(status: Order["status"]): boolean {
  return RETURN_FLOW_STATUSES.has(status);
}

/**
 * @deprecated Order-status refunds are disabled. Refunds must go through a
 * ReturnRequest that is REFUND_ELIGIBLE (warehouse + inspection) via
 * POST /api/admin/returns/[id] { action: "refund" }.
 */
export function adminCanRefundOrder(_order: Order): boolean {
  return false;
}
