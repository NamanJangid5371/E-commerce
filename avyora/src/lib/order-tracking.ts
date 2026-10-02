import type { Order, OrderStatus, OrderTrackingEvent } from "@/store/shop-types";

export const TRACKING_ORIGIN = "Avyora Atelier, Bengaluru";

export const CHECKPOINT_PRESETS = [
  { id: "qc", title: "Quality inspection complete", location: TRACKING_ORIGIN, description: "Your piece passed our final quality check." },
  { id: "packed", title: "Packed & sealed", location: TRACKING_ORIGIN, description: "Insured packaging completed and label applied." },
  { id: "ready-to-ship", title: "Ready to ship", location: TRACKING_ORIGIN, description: "The parcel is packed and waiting for courier handoff." },
  { id: "hub-out", title: "Left dispatch hub", location: "Bengaluru dispatch hub", description: "Package handed to courier partner." },
  { id: "in-transit", title: "In transit", location: "En route", description: "Your shipment is moving toward the delivery city." },
  { id: "local-hub", title: "Reached local hub", location: "Destination city hub", description: "Package arrived at the delivery city sorting centre." },
  { id: "out-for-delivery", title: "Out for delivery", location: "Local courier", description: "Courier is on the way to your address today." },
  { id: "delivery-attempt", title: "Delivery attempted", location: "Delivery address", description: "We attempted delivery — our team will follow up if needed." },
  { id: "return-pickup", title: "Return pickup scheduled", location: TRACKING_ORIGIN, description: "A reverse pickup is being arranged for your return." },
  { id: "rto", title: "Return to origin initiated", location: "Courier network", description: "The shipment is returning to the warehouse after failed delivery." },
] as const;

const STATUS_CHECKPOINTS: Partial<
  Record<
    OrderStatus,
    (order: Order) => Omit<OrderTrackingEvent, "id" | "at">
  >
> = {
  Confirmed: () => ({
    status: "Confirmed",
    title: "Order confirmed",
    location: TRACKING_ORIGIN,
    description: "Your order is confirmed and reserved in our atelier.",
  }),
  Processing: () => ({
    status: "Processing",
    title: "Processing",
    location: TRACKING_ORIGIN,
    description: "Our team is preparing the piece for packing and dispatch.",
  }),
  Packed: () => ({
    status: "Packed",
    title: "Packed & quality checked",
    location: TRACKING_ORIGIN,
    description: "Your piece has been packed with insured shipping materials.",
  }),
  "Ready to Ship": () => ({
    status: "Ready to Ship",
    title: "Ready to ship",
    location: TRACKING_ORIGIN,
    description: "The parcel is packed and waiting for courier pickup.",
  }),
  Shipped: (order) => ({
    status: "Shipped",
    title: "Shipped",
    location: order.deliveryPartner ? `${order.deliveryPartner} network` : "Bengaluru dispatch hub",
    description: order.trackingId
      ? `Tracking ${order.trackingId}. Your package is with our courier partner.`
      : "Your package is with our courier partner.",
  }),
  "In Transit": (order) => ({
    status: "In Transit",
    title: "In transit",
    location: order.deliveryPartner ? `${order.deliveryPartner} route` : "Courier network",
    description: "Your shipment is moving between courier hubs.",
  }),
  "Out for Delivery": (order) => ({
    status: "Out for Delivery",
    title: "Out for delivery",
    location: order.address.city,
    description: "Courier is on the way to your address today.",
  }),
  Delivered: (order) => ({
    status: "Delivered",
    title: "Delivered",
    location: order.address.city,
    description: "Delivered successfully. We hope you love your piece.",
  }),
  Cancelled: () => ({
    status: "Cancelled",
    title: "Order cancelled",
    location: TRACKING_ORIGIN,
    description: "This order was cancelled.",
  }),
  "Failed Delivery": (order) => ({
    status: "Failed Delivery",
    title: "Delivery attempt failed",
    location: order.address.city,
    description: "Delivery was attempted but not completed. We will try again or contact you.",
  }),
  "Return Requested": () => ({
    status: "Return Requested",
    title: "Return requested",
    location: TRACKING_ORIGIN,
    description: "We received your return request and will share pickup details soon.",
  }),
  "Return Pickup": () => ({
    status: "Return Pickup",
    title: "Return pickup scheduled",
    location: TRACKING_ORIGIN,
    description: "A reverse pickup has been arranged for this return.",
  }),
  Returned: () => ({
    status: "Returned",
    title: "Returned to atelier",
    location: TRACKING_ORIGIN,
    description: "The returned order has been received back at the atelier.",
  }),
  RTO: () => ({
    status: "RTO",
    title: "Return to origin",
    location: TRACKING_ORIGIN,
    description: "The shipment is returning to the warehouse after delivery failure.",
  }),
  Refunded: () => ({
    status: "Refunded",
    title: "Refund processed",
    location: TRACKING_ORIGIN,
    description: "Your refund has been processed to the original payment method.",
  }),
};

export function createTrackingEvent(
  input: Omit<OrderTrackingEvent, "id" | "at"> & { at?: string },
): OrderTrackingEvent {
  return {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    at: input.at ?? new Date().toISOString(),
    status: input.status,
    title: input.title,
    location: input.location,
    description: input.description,
    updatedBy: input.updatedBy,
    deliveryPartner: input.deliveryPartner,
  };
}

export function checkpointForStatus(order: Order, status: OrderStatus): OrderTrackingEvent | null {
  const build = STATUS_CHECKPOINTS[status];
  if (!build) return null;
  return createTrackingEvent(build(order));
}

export function appendTrackingEvent(order: Order, event: OrderTrackingEvent): OrderTrackingEvent[] {
  const list = order.trackingEvents ?? [];
  if (event.status !== "Update") {
    const duplicate = list.some(
      (e) => e.status === event.status && e.title === event.title && e.location === event.location,
    );
    if (duplicate) return list;
  }
  return [event, ...list].sort((a, b) => +new Date(b.at) - +new Date(a.at));
}

/** Build a readable timeline for orders created before trackingEvents existed. */
export function resolveOrderTrackingEvents(order: Order): OrderTrackingEvent[] {
  if (order.trackingEvents?.length) {
    return [...order.trackingEvents].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }

  const synthetic: OrderTrackingEvent[] = [
    createTrackingEvent({
      at: order.createdAt,
      status: "Confirmed",
      title: "Order placed",
      location: TRACKING_ORIGIN,
      description: "Your order was received.",
    }),
  ];

  const flow: OrderStatus[] = ["Confirmed", "Processing", "Packed", "Ready to Ship", "Shipped", "In Transit", "Out for Delivery", "Delivered"];
  const idx = flow.indexOf(order.status as (typeof flow)[number]);
  if (idx >= 1) {
    const processing = checkpointForStatus(order, "Processing");
    if (processing) synthetic.unshift({ ...processing, at: order.createdAt });
  }
  if (idx >= 2 || order.status === "Shipped") {
    const packed = checkpointForStatus(order, "Packed");
    if (packed) synthetic.unshift(packed);
  }
  if (idx >= 3 || order.status === "Ready to Ship") {
    const ready = checkpointForStatus(order, "Ready to Ship");
    if (ready) synthetic.unshift(ready);
  }
  if (idx >= 4 || order.status === "Shipped") {
    const shipped = checkpointForStatus(order, "Shipped");
    if (shipped) synthetic.unshift(shipped);
  }
  if (idx >= 5 || order.status === "In Transit") {
    const transit = checkpointForStatus(order, "In Transit");
    if (transit) synthetic.unshift(transit);
  }
  if (idx >= 6 || order.status === "Out for Delivery") {
    const outForDelivery = checkpointForStatus(order, "Out for Delivery");
    if (outForDelivery) synthetic.unshift(outForDelivery);
  }
  if (order.status === "Delivered") {
    const delivered = checkpointForStatus(order, "Delivered");
    if (delivered) synthetic.unshift(delivered);
  }
  if (order.status === "Cancelled") {
    const cancelled = checkpointForStatus(order, "Cancelled");
    if (cancelled) synthetic.unshift(cancelled);
  }
  if (order.status === "Return Requested") {
    const ret = checkpointForStatus(order, "Return Requested");
    if (ret) synthetic.unshift(ret);
  }
  if (order.status === "Return Pickup") {
    const pickup = checkpointForStatus(order, "Return Pickup");
    if (pickup) synthetic.unshift(pickup);
  }
  if (order.status === "Failed Delivery") {
    const failed = checkpointForStatus(order, "Failed Delivery");
    if (failed) synthetic.unshift(failed);
  }
  if (order.status === "RTO") {
    const rto = checkpointForStatus(order, "RTO");
    if (rto) synthetic.unshift(rto);
  }
  if (order.status === "Returned") {
    const returned = checkpointForStatus(order, "Returned");
    if (returned) synthetic.unshift(returned);
  }
  if (order.status === "Refunded") {
    const refunded = checkpointForStatus(order, "Refunded");
    if (refunded) synthetic.unshift(refunded);
  }

  return synthetic.sort((a, b) => +new Date(b.at) - +new Date(a.at));
}

export function latestTrackingUpdate(order: Order): OrderTrackingEvent | undefined {
  return resolveOrderTrackingEvents(order)[0];
}

export function notifyTemplateForEvent(event: OrderTrackingEvent): string {
  if (event.status === "Delivered") return "n-del";
  if (event.status === "Cancelled") return "n-can";
  if (event.status === "Refunded" || event.status === "Return Requested" || event.status === "Returned") return "n-ret";
  if (event.status === "Out for Delivery" || event.status === "Failed Delivery") return "n-tracking";
  if (event.status === "Shipped") return "n-ship";
  if (event.status === "In Transit" || event.status === "Ready to Ship") return "n-tracking";
  if (event.status === "Packed") return "n-packed";
  if (event.status === "Confirmed") return "n-order";
  return "n-tracking";
}
