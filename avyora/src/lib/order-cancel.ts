import type { Order, OrderStatus } from "@/store/shop-types";

/** Statuses where the customer may still cancel before the piece ships. */
export const CUSTOMER_CANCELLABLE_STATUSES: OrderStatus[] = [
  "Pending Payment",
  "Confirmed",
  "Processing",
  "Packed",
  "Ready to Ship",
];

function orderEmailMatches(order: Order, customerEmail: string) {
  const orderEmail = order.customerEmail?.trim().toLowerCase();
  const sessionEmail = customerEmail.trim().toLowerCase();
  // Missing email on the client order still allows the attempt — the API enforces ownership.
  if (!orderEmail) return true;
  return orderEmail === sessionEmail;
}

export function customerCanCancelOrder(order: Order, customerEmail?: string | null) {
  if (!customerEmail) return false;
  if (!orderEmailMatches(order, customerEmail)) return false;
  return CUSTOMER_CANCELLABLE_STATUSES.includes(order.status);
}

export function customerCancelBlockedReason(order: Order) {
  if (order.status === "Cancelled") return "This order is already cancelled.";
  if (order.status === "Refunded") return "This order was refunded and cannot be cancelled.";
  if (
    order.status === "Shipped" ||
    order.status === "In Transit" ||
    order.status === "Out for Delivery"
  ) {
    return "This order has already shipped. Contact us if you need help.";
  }
  if (order.status === "Delivered" || order.status === "Return Requested") {
    return "Delivered orders cannot be cancelled. You can request a return instead.";
  }
  if (order.status === "Returned" || order.status === "RTO") {
    return "This order was returned and cannot be cancelled.";
  }
  return "This order can no longer be cancelled.";
}
