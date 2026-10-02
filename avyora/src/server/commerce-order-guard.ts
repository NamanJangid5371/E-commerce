import { isCodPaymentMethod } from "@/lib/payment-method";
import type { Order } from "@/store/shop-types";

export { isCodPaymentMethod };

/** Fields owned exclusively by logistics APIs (not admin commerce PUT). */
export const LOGISTICS_OWNED_ORDER_FIELDS = [
  "shipmentId",
  "trackingId",
  "deliveryPartner",
  "estimatedShippingDate",
  "estimatedDeliveryDate",
  "trackingEvents",
  "deliveryAttempts",
] as const;

function adminMaySetStatus(current: Order, incoming: Order): boolean {
  if (incoming.status === "Cancelled" || incoming.status === "Refunded") return true;
  // Reject return → back to Delivered
  if (current.status === "Return Requested" && incoming.status === "Delivered") return true;
  return false;
}

function adminMaySetPaymentStatus(incoming: Order): boolean {
  return incoming.paymentStatus === "Cancelled" || incoming.paymentStatus === "Refunded";
}

/**
 * Merge incoming admin commerce orders into the server snapshot while preserving
 * logistics-owned shipment/COD fields. New order ids are kept (append-only).
 */
export function mergeOrdersPreservingLogistics(
  currentOrders: Order[],
  incomingOrders: Order[] | undefined,
): Order[] {
  if (!incomingOrders) return currentOrders;

  const currentById = new Map(currentOrders.map((order) => [order.id, order]));
  const merged: Order[] = [];
  const seen = new Set<string>();

  for (const incoming of incomingOrders) {
    seen.add(incoming.id);
    const current = currentById.get(incoming.id);
    if (!current) {
      merged.push(incoming);
      continue;
    }

    const next: Order = {
      ...incoming,
      shipmentId: current.shipmentId,
      trackingId: current.trackingId,
      deliveryPartner: current.deliveryPartner,
      estimatedShippingDate: current.estimatedShippingDate,
      estimatedDeliveryDate: current.estimatedDeliveryDate,
      trackingEvents: current.trackingEvents,
      deliveryAttempts: current.deliveryAttempts,
      // Admin may edit notes / return / cancel / refund amount.
      notes: incoming.notes,
      returnReason: incoming.returnReason,
      cancelReason: incoming.cancelReason,
      refundedAmount: incoming.refundedAmount,
    };

    if (adminMaySetStatus(current, incoming)) {
      next.status = incoming.status;
      next.lastUpdatedAt = incoming.lastUpdatedAt ?? new Date().toISOString();
      next.lastUpdatedBy = incoming.lastUpdatedBy ?? current.lastUpdatedBy;
    } else {
      next.status = current.status;
      next.lastUpdatedAt = current.lastUpdatedAt;
      next.lastUpdatedBy = current.lastUpdatedBy;
    }

    if (adminMaySetPaymentStatus(incoming)) {
      next.paymentStatus = incoming.paymentStatus;
    } else {
      // COD collection / paymentSuccess is logistics-owned.
      next.paymentStatus = current.paymentStatus;
    }

    merged.push(next);
  }

  // Keep server orders that were dropped from the admin snapshot (avoid wiping logistics updates).
  for (const order of currentOrders) {
    if (!seen.has(order.id)) merged.push(order);
  }

  return merged.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}
