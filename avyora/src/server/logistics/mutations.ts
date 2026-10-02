import {
  addDeliveryAttempt,
  applyOrderStatusUpdate,
  applyShipmentPatch,
  canTransitionOrderStatus,
} from "@/lib/logistics-orders";
import { appendTrackingEvent, createTrackingEvent } from "@/lib/order-tracking";
import type { DeliveryAttemptReason, Order, OrderStatus } from "@/store/shop-types";
import { isCodPaymentMethod } from "@/lib/payment-method";
import { loadCommerce } from "@/server/commerce-db";
import { loadOrderByNumber } from "@/server/orders/load-orders";
import { mirrorClientOrderToCommerce } from "@/server/orders/mirror-commerce";
import { syncLogisticsOrderToPrisma } from "@/server/orders/sync-logistics-prisma";
import { isCommerceOrderFallbackEnabled } from "@/server/sot/transactional";
import { logger } from "@/server/logger";

/**
 * Resolve order for logistics: PostgreSQL is SoT.
 * commerce.json fallback is opt-in (dev emergency only) and never used in production.
 */
export async function findOpsOrder(id: string) {
  const fromDb = await loadOrderByNumber(id);
  if (fromDb) return { order: fromDb, source: "postgres" as const };

  if (!isCommerceOrderFallbackEnabled()) {
    return { order: undefined, source: "postgres" as const };
  }

  const commerce = loadCommerce();
  const order = commerce.orders.find((entry) => entry.id === id);
  if (order) {
    logger.warn("sot.commerce_order_fallback_used", { orderId: id });
  }
  return { order, source: "commerce" as const };
}

/** @deprecated Prefer findOpsOrder — JSON-only lookup. */
export function findCommerceOrder(id: string) {
  const commerce = loadCommerce();
  const order = commerce.orders.find((entry) => entry.id === id);
  return { commerce, order };
}

/**
 * Persist logistics changes: Postgres first (SoT), then best-effort mirror into commerce.json.
 * Mirror failure must not roll back the Postgres write.
 */
export async function persistOrder(_orderId: string, nextOrder: Order, actorEmail?: string) {
  if (actorEmail) {
    await syncLogisticsOrderToPrisma(nextOrder, actorEmail);
  }
  try {
    await mirrorClientOrderToCommerce(nextOrder);
  } catch (error) {
    logger.warn("sot.order_mirror_failed", { orderId: nextOrder.id, error: String(error) });
  }
  return nextOrder;
}

export function patchLogisticsOrder(
  order: Order,
  input: {
    status?: OrderStatus;
    shipmentId?: string;
    trackingId?: string;
    deliveryPartner?: string;
    estimatedShippingDate?: string;
    estimatedDeliveryDate?: string;
    location?: string;
    note?: string;
    returnReason?: string;
    /** Generate a full-order refund (sets Refunded + amount). */
    generateRefund?: boolean;
    refundedAmount?: number;
    /** COD cash collection — logistics only. */
    paymentStatus?: "Success" | "Pending" | "Failed";
    collectCod?: boolean;
    updatedBy: string;
  },
) {
  let nextOrder: Order = applyShipmentPatch(order, {
    shipmentId: input.shipmentId,
    trackingId: input.trackingId,
    deliveryPartner: input.deliveryPartner,
    estimatedShippingDate: input.estimatedShippingDate,
    estimatedDeliveryDate: input.estimatedDeliveryDate,
  });

  if (input.returnReason !== undefined) {
    nextOrder = {
      ...nextOrder,
      returnReason: input.returnReason.trim() || undefined,
    };
  }

  const targetStatus: OrderStatus | undefined = input.generateRefund
    ? "Refunded"
    : input.status;

  if (targetStatus) {
    const check = canTransitionOrderStatus(order.status, targetStatus);
    if (!check.ok) return { ok: false as const, message: check.message };
    const note =
      input.note ||
      (targetStatus === "Refunded"
        ? input.returnReason ?? nextOrder.returnReason
        : input.returnReason) ||
      undefined;
    nextOrder = applyOrderStatusUpdate(nextOrder, targetStatus, {
      location: input.location,
      note,
      updatedBy: input.updatedBy,
    }).order;
    // COD payment is never auto-marked on Delivered — requires OTP + cash/UPI via COD service.
    if (targetStatus === "Refunded") {
      const amount =
        typeof input.refundedAmount === "number" && input.refundedAmount > 0
          ? input.refundedAmount
          : nextOrder.refundedAmount && nextOrder.refundedAmount > 0
            ? nextOrder.refundedAmount
            : nextOrder.total;
      nextOrder = {
        ...nextOrder,
        refundedAmount: amount,
        paymentStatus: "Refunded",
      };
    }
  } else {
    nextOrder = {
      ...nextOrder,
      lastUpdatedAt: new Date().toISOString(),
      lastUpdatedBy: input.updatedBy,
    };
  }

  if (input.collectCod || input.paymentStatus === "Success") {
    return {
      ok: false as const,
      message:
        "COD payment must be recorded via verified cash collection or doorstep UPI (OTP required).",
    };
  }
  if (input.paymentStatus === "Pending" || input.paymentStatus === "Failed") {
    if (!isCodPaymentMethod(nextOrder.paymentMethod)) {
      return { ok: false as const, message: "Payment status updates for prepaid orders are not managed here." };
    }
    nextOrder = {
      ...nextOrder,
      paymentStatus: input.paymentStatus,
      lastUpdatedAt: new Date().toISOString(),
      lastUpdatedBy: input.updatedBy,
    };
  }

  return { ok: true as const, order: nextOrder };
}

export function recordLogisticsAttempt(
  order: Order,
  input: {
    status: "attempted" | "failed" | "rescheduled" | "delivered";
    reason?: DeliveryAttemptReason;
    note?: string;
    location?: string;
    setFailedDelivery?: boolean;
    updatedBy: string;
  },
) {
  let next: Order = addDeliveryAttempt(order, {
    status: input.status,
    reason: input.reason,
    note: input.note,
    location: input.location,
    updatedBy: input.updatedBy,
  }).order;

  const shouldFail =
    input.setFailedDelivery === true ||
    (input.setFailedDelivery !== false && input.status === "failed");

  if (shouldFail && next.status !== "Failed Delivery") {
    const check = canTransitionOrderStatus(next.status, "Failed Delivery");
    if (!check.ok) return { ok: false as const, message: check.message };
    next = applyOrderStatusUpdate(next, "Failed Delivery", {
      location: input.location,
      note: input.note || input.reason,
      updatedBy: input.updatedBy,
    }).order;
  }

  return { ok: true as const, order: next };
}

export function addLogisticsTrackingEvent(
  order: Order,
  input: {
    title: string;
    location?: string;
    description?: string;
    updatedBy: string;
  },
) {
  const event = createTrackingEvent({
    status: "Update",
    title: input.title.trim(),
    location: input.location?.trim() || undefined,
    description: input.description?.trim() || undefined,
    updatedBy: input.updatedBy,
    deliveryPartner: order.deliveryPartner,
  });

  return {
    order: {
      ...order,
      lastUpdatedAt: event.at,
      lastUpdatedBy: input.updatedBy,
      trackingEvents: appendTrackingEvent(order, event),
    } satisfies Order,
    event,
  };
}
