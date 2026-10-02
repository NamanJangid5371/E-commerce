import { isCodPaymentMethod } from "@/lib/payment-method";
import { checkpointForStatus, createTrackingEvent, appendTrackingEvent } from "@/lib/order-tracking";
import type {
  DeliveryAttempt,
  DeliveryAttemptReason,
  Order,
  OrderStatus,
  OrderTrackingEvent,
} from "@/store/shop-types";

export const LOGISTICS_STATUSES: OrderStatus[] = [
  "Pending Payment",
  "Confirmed",
  "Processing",
  "Packed",
  "Ready to Ship",
  "Shipped",
  "In Transit",
  "Out for Delivery",
  "Delivered",
  "Cancelled",
  "Failed Delivery",
  "Return Requested",
  "Return Pickup",
  "Returned",
  "RTO",
  "Refunded",
];

/** Normal outbound shipment flow (logistics Update status — shipment type). */
export const SHIPMENT_FLOW_STATUSES: OrderStatus[] = [
  "Confirmed",
  "Processing",
  "Packed",
  "Ready to Ship",
  "Shipped",
  "In Transit",
  "Out for Delivery",
  "Delivered",
  "Failed Delivery",
  "RTO",
  "Cancelled",
];

/**
 * Reverse-logistics stages (item-level ReturnRequest).
 * Updated from logistics order page → syncs to admin returns + customer timeline.
 */
export const RETURN_FLOW_STAGES = [
  { status: "PICKUP_SCHEDULED", label: "Pickup scheduled", action: "schedule_pickup" },
  { status: "PICKED_UP", label: "Picked up", action: "mark_picked_up" },
  { status: "IN_TRANSIT", label: "In transit", action: "mark_in_transit" },
  { status: "RECEIVED_AT_WAREHOUSE", label: "Received at warehouse", action: "receive_warehouse" },
  { status: "INSPECTION_APPROVED", label: "Inspection confirmed", action: "approve_inspection" },
  { status: "INSPECTION_REJECTED", label: "Inspection rejected", action: "reject_inspection" },
] as const;

export type ReturnFlowStageStatus = (typeof RETURN_FLOW_STAGES)[number]["status"];

/** Return stages logistics can act on — only after admin approval. */
export const LOGISTICS_ACTIVE_RETURN_STATUSES = [
  "RETURN_APPROVED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "IN_TRANSIT",
  "RECEIVED_AT_WAREHOUSE",
  "INSPECTION_PENDING",
  "INSPECTION_APPROVED",
] as const;

export function isLogisticsReturnActionable(status: string): boolean {
  return (LOGISTICS_ACTIVE_RETURN_STATUSES as readonly string[]).includes(status);
}

const FLOW: OrderStatus[] = [
  "Pending Payment",
  "Confirmed",
  "Processing",
  "Packed",
  "Ready to Ship",
  "Shipped",
  "In Transit",
  "Out for Delivery",
  "Delivered",
];

export const DELIVERY_ATTEMPT_REASONS: DeliveryAttemptReason[] = [
  "Customer unavailable",
  "Incorrect address",
  "Customer requested reschedule",
  "Delivery refused",
  "Other",
];

const TERMINAL_STATUSES: OrderStatus[] = ["Cancelled", "Refunded", "Returned"];
const REFUNDABLE_STATUSES: OrderStatus[] = ["Delivered", "Return Requested", "Return Pickup", "Returned", "Failed Delivery", "RTO"];

export function isDelayedShipment(order: Order, now = new Date()) {
  if (!order.estimatedDeliveryDate) return false;
  if (order.status === "Delivered" || order.status === "Cancelled" || order.status === "Refunded" || order.status === "Returned") {
    return false;
  }
  return +new Date(order.estimatedDeliveryDate) < +now;
}

export function statusBadgeTone(status: OrderStatus) {
  if (status === "Delivered" || status === "Ready to Ship") return "emerald";
  if (status === "Cancelled" || status === "Failed Delivery" || status === "RTO") return "rose";
  if (status === "Return Requested" || status === "Return Pickup" || status === "Returned" || status === "Refunded") return "amber";
  if (status === "Out for Delivery" || status === "In Transit" || status === "Shipped") return "blue";
  return "stone";
}

export function awaitingProcessing(order: Order) {
  return order.status === "Pending Payment" || order.status === "Confirmed" || order.status === "Processing";
}

export function readyToPack(order: Order) {
  return order.status === "Confirmed" || order.status === "Processing";
}

export function readyToShip(order: Order) {
  return order.status === "Packed" || order.status === "Ready to Ship";
}

export const LOGISTICS_QUEUES = [
  { id: "awaiting", label: "Awaiting processing" },
  { id: "pack", label: "To pack" },
  { id: "ship", label: "Ready to hand over" },
  { id: "transit", label: "In transit" },
  { id: "ofd", label: "Out for delivery" },
  { id: "delivered", label: "Delivered" },
  { id: "exceptions", label: "Failed & RTO" },
  { id: "returns", label: "Returns" },
  { id: "delayed", label: "Delayed" },
  { id: "cod", label: "COD to collect" },
  { id: "unassigned", label: "No courier" },
] as const;

export type LogisticsQueueId = (typeof LOGISTICS_QUEUES)[number]["id"];

const CLOSED_STATUSES: OrderStatus[] = ["Cancelled", "Refunded", "Delivered", "Returned"];

export function orderMatchesQueue(order: Order, queue: string) {
  switch (queue) {
    case "awaiting":
      return awaitingProcessing(order);
    case "pack":
      return readyToPack(order);
    case "ship":
      return readyToShip(order);
    case "transit":
      return inTransit(order);
    case "ofd":
      return order.status === "Out for Delivery";
    case "delivered":
      return order.status === "Delivered";
    case "exceptions":
      return order.status === "Failed Delivery" || order.status === "RTO";
    case "returns":
      return order.status === "Return Requested" || order.status === "Return Pickup" || order.status === "Returned" || order.status === "RTO";
    case "delayed":
      return isDelayedShipment(order);
    case "cod":
      return (
        isCodPaymentMethod(order.paymentMethod) &&
        (order.paymentStatus ?? "Pending") !== "Success" &&
        !CLOSED_STATUSES.includes(order.status)
      );
    case "unassigned":
      return (
        !order.deliveryPartner &&
        order.status !== "Pending Payment" &&
        order.status !== "Cancelled" &&
        !CLOSED_STATUSES.includes(order.status)
      );
    default:
      return true;
  }
}

export function nextPackStep(order: Order): { status: OrderStatus; label: string } | null {
  if (order.status === "Confirmed") return { status: "Processing", label: "Start packing" };
  if (order.status === "Processing") return { status: "Packed", label: "Mark packed" };
  return null;
}

export function statusBadgeClass(status: OrderStatus) {
  const tone = statusBadgeTone(status);
  if (tone === "rose") return "bg-rose-100 text-rose-900";
  if (tone === "amber") return "bg-amber-100 text-amber-900";
  if (tone === "blue") return "bg-sky-100 text-sky-900";
  if (tone === "emerald") return "bg-emerald-100 text-emerald-900";
  return "bg-stone-100 text-stone-900";
}

export function codToCollect(order: Order) {
  if (!isCodPaymentMethod(order.paymentMethod)) return 0;
  if ((order.paymentStatus ?? "Pending") === "Success") return 0;
  if (order.status === "Cancelled" || order.status === "Refunded") return 0;
  return order.total;
}

/** Statuses that should receive a warehouse sticky shipping label. */
export const SHIPPING_LABEL_ELIGIBLE_STATUSES: OrderStatus[] = [
  "Confirmed",
  "Processing",
  "Packed",
  "Ready to Ship",
];

/** Statuses that must never get a shipping label in bulk (not meant to ship). */
export const SHIPPING_LABEL_EXCLUDED_STATUSES: OrderStatus[] = [
  "Pending Payment",
  "Cancelled",
  "Refunded",
  "Returned",
  "RTO",
  "Return Requested",
  "Return Pickup",
];

/**
 * New / pack-ready orders eligible for sticky labels.
 * Excludes unpaid, cancelled, returned, and other non-ship statuses.
 */
export function isEligibleForShippingLabel(order: Order): { ok: true } | { ok: false; reason: string } {
  if (SHIPPING_LABEL_EXCLUDED_STATUSES.includes(order.status)) {
    return { ok: false, reason: `Status "${order.status}" is not meant for shipping labels` };
  }
  if (!SHIPPING_LABEL_ELIGIBLE_STATUSES.includes(order.status)) {
    return {
      ok: false,
      reason: `Only Confirmed / Processing / Packed / Ready to Ship orders get new labels (got "${order.status}")`,
    };
  }
  if (order.paymentStatus === "Failed" || order.paymentStatus === "Cancelled") {
    return { ok: false, reason: "Payment failed or cancelled" };
  }
  if (!order.items?.length) {
    return { ok: false, reason: "Order has no products" };
  }
  if (!order.address?.name?.trim() && !order.address?.line1?.trim()) {
    return { ok: false, reason: "Shipping address incomplete" };
  }
  return { ok: true };
}

export function inTransit(order: Order) {
  return order.status === "Shipped" || order.status === "In Transit";
}

export function canTransitionOrderStatus(current: OrderStatus, next: OrderStatus) {
  if (current === next) return { ok: false, message: "Order is already in that status." };

  if (next === "Refunded") {
    if (!REFUNDABLE_STATUSES.includes(current)) {
      return { ok: false, message: "Refund is only allowed after delivery/return/failure flows." };
    }
    return { ok: true as const };
  }

  if (TERMINAL_STATUSES.includes(current)) {
    return { ok: false, message: `Cannot move an order after ${current.toLowerCase()}.` };
  }

  if (next === "Cancelled") {
    if (current === "Delivered" || current === "Return Requested" || current === "Return Pickup" || current === "Returned" || current === "RTO") {
      return { ok: false, message: "Delivered/returned orders cannot be cancelled." };
    }
    return { ok: true as const };
  }

  if (next === "Return Requested") {
    return current === "Delivered"
      ? { ok: true as const }
      : { ok: false, message: "Returns can only be requested after delivery." };
  }

  if (next === "Return Pickup") {
    return current === "Return Requested"
      ? { ok: true as const }
      : { ok: false, message: "Return pickup requires a return-requested order." };
  }

  if (next === "Returned") {
    return current === "Return Requested" || current === "Return Pickup" || current === "Delivered" || current === "RTO"
      ? { ok: true as const }
      : { ok: false, message: "Returned status requires a delivered/return-requested order." };
  }

  if (next === "Failed Delivery") {
    return current === "Out for Delivery" || current === "Shipped" || current === "In Transit"
      ? { ok: true as const }
      : { ok: false, message: "Failed delivery requires a shipped or out-for-delivery order." };
  }

  if (next === "RTO") {
    return current === "Failed Delivery"
      ? { ok: true as const }
      : { ok: false, message: "RTO requires a failed-delivery step first." };
  }

  if (current === "Failed Delivery" && next === "Out for Delivery") {
    return { ok: true as const };
  }

  const currentIndex = FLOW.indexOf(current);
  const nextIndex = FLOW.indexOf(next);
  if (currentIndex === -1 || nextIndex === -1) {
    return { ok: false, message: "Unsupported status transition." };
  }
  if (nextIndex < currentIndex) {
    return { ok: false, message: "Backward status transitions are not allowed." };
  }
  if (nextIndex > currentIndex + 1) {
    return { ok: false, message: "Advance the order one stage at a time." };
  }

  return { ok: true as const };
}

export function applyShipmentPatch(
  order: Order,
  patch: Partial<Pick<Order, "trackingId" | "deliveryPartner" | "estimatedShippingDate" | "estimatedDeliveryDate" | "shipmentId">>,
): Order {
  const next: Order = { ...order };
  if (patch.shipmentId !== undefined) next.shipmentId = patch.shipmentId;
  if (patch.trackingId !== undefined) next.trackingId = patch.trackingId;
  if (patch.deliveryPartner !== undefined) next.deliveryPartner = patch.deliveryPartner;
  if (patch.estimatedShippingDate !== undefined) next.estimatedShippingDate = patch.estimatedShippingDate;
  if (patch.estimatedDeliveryDate !== undefined) next.estimatedDeliveryDate = patch.estimatedDeliveryDate;
  return next;
}

export function buildStatusEvent(
  order: Order,
  status: OrderStatus,
  input?: { location?: string; note?: string; updatedBy?: string },
): OrderTrackingEvent {
  const base = checkpointForStatus(order, status);
  if (!base) {
    return createTrackingEvent({
      status,
      title: status,
      location: input?.location,
      description: input?.note,
      updatedBy: input?.updatedBy,
      deliveryPartner: order.deliveryPartner,
    });
  }

  return {
    ...base,
    location: input?.location ?? base.location,
    description: input?.note ?? base.description,
    updatedBy: input?.updatedBy,
    deliveryPartner: order.deliveryPartner,
  };
}

export function applyOrderStatusUpdate(
  order: Order,
  status: OrderStatus,
  input?: { location?: string; note?: string; updatedBy?: string },
) {
  const nextBase = {
    ...order,
    status,
    lastUpdatedAt: new Date().toISOString(),
    lastUpdatedBy: input?.updatedBy ?? order.lastUpdatedBy,
  } satisfies Order;

  const withGeneratedShipment =
    status === "Shipped" && !nextBase.trackingId
      ? { ...nextBase, trackingId: `AVSHIP${Math.floor(100000 + Math.random() * 900000)}` }
      : nextBase;

  const event = buildStatusEvent(withGeneratedShipment, status, input);

  const updated: Order = {
    ...withGeneratedShipment,
    cancelReason: status === "Cancelled" ? input?.note ?? order.cancelReason : order.cancelReason,
    returnReason:
      status === "Return Requested" ||
      status === "Return Pickup" ||
      status === "Returned" ||
      status === "Refunded"
        ? input?.note ?? order.returnReason
        : order.returnReason,
    ...(status === "Refunded"
      ? {
          refundedAmount: order.refundedAmount && order.refundedAmount > 0 ? order.refundedAmount : order.total,
          paymentStatus: "Refunded" as const,
        }
      : {}),
    trackingEvents: appendTrackingEvent(withGeneratedShipment, event),
  };

  return {
    order: updated,
    event,
  };
}

export function addDeliveryAttempt(
  order: Order,
  input: {
    status: DeliveryAttempt["status"];
    reason?: DeliveryAttemptReason;
    note?: string;
    location?: string;
    updatedBy?: string;
  },
) {
  const attempts = order.deliveryAttempts ?? [];
  const attemptNumber = attempts.length + 1;
  const at = new Date().toISOString();
  const attempt: DeliveryAttempt = {
    id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    attemptNumber,
    at,
    status: input.status,
    reason: input.reason,
    note: input.note,
    updatedBy: input.updatedBy,
    deliveryPartner: order.deliveryPartner,
  };

  const event = createTrackingEvent({
    status: "Update",
    title:
      input.status === "delivered"
        ? "Delivered after attempt"
        : `Delivery attempt ${attemptNumber}`,
    location: input.location ?? order.address.city,
    description: [input.reason, input.note].filter(Boolean).join(" — ") || "Delivery attempt recorded.",
    updatedBy: input.updatedBy,
    deliveryPartner: order.deliveryPartner,
  });

  return {
    attempt,
    event,
    order: {
      ...order,
      lastUpdatedAt: at,
      lastUpdatedBy: input.updatedBy ?? order.lastUpdatedBy,
      deliveryAttempts: [attempt, ...attempts].sort((a, b) => +new Date(b.at) - +new Date(a.at)),
      trackingEvents: appendTrackingEvent(order, event),
    } satisfies Order,
  };
}

export function orderSearchText(order: Order) {
  return [
    order.id,
    order.address.name,
    order.address.phone,
    order.customerEmail,
    order.trackingId,
    order.deliveryPartner,
    order.items.map((item) => item.name).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
