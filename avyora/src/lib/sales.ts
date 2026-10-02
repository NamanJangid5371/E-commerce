import { isCodPaymentMethod } from "@/lib/payment-method";
import type { Order, OrderStatus } from "@/store/shop-types";

/** Order statuses that never count toward sales. */
const EXCLUDED_STATUSES: OrderStatus[] = ["Cancelled", "Pending Payment"];

/** Payment states that mean money was not collected as a sale (refunds are netted separately). */
const EXCLUDED_PAYMENTS = new Set(["Pending", "Failed", "Cancelled"]);

/**
 * A recognized sale: booked / paid order path.
 * - Excludes cancelled and unpaid (pending payment) orders
 * - Fully/partially refunded orders still count; {@link saleAmount} subtracts refunds
 * - COD with Pending payment still counts once the order is Confirmed+
 * - Older rows without paymentStatus still count if order status is active
 */
export function isRecognizedSale(order: Order): boolean {
  if (EXCLUDED_STATUSES.includes(order.status)) return false;
  if (order.paymentStatus && EXCLUDED_PAYMENTS.has(order.paymentStatus)) {
    if (order.paymentStatus === "Pending" && isCodPaymentMethod(order.paymentMethod)) {
      return true;
    }
    return false;
  }
  return true;
}

/** Orders placed today for ops KPIs (not only paid/recognized sales). */
export function todayPlacedOrders(orders: Order[], now = new Date()): Order[] {
  return orders.filter((order) => {
    if (order.status === "Cancelled") return false;
    return isSameLocalDay(order.createdAt, now);
  });
}

/**
 * Net contribution to sales revenue.
 * Refunded amount is always subtracted from order total (full refund → 0).
 */
export function saleAmount(order: Order): number {
  if (!isRecognizedSale(order)) return 0;
  const refunded =
    order.refundedAmount != null && order.refundedAmount > 0
      ? order.refundedAmount
      : order.status === "Refunded" || order.paymentStatus === "Refunded"
        ? order.total
        : 0;
  return Math.max(0, order.total - refunded);
}

export function isSameLocalDay(iso: string, now = new Date()): boolean {
  return new Date(iso).toDateString() === now.toDateString();
}

export function filterSales(orders: Order[]): Order[] {
  return orders.filter(isRecognizedSale);
}

export function sumSales(orders: Order[]): number {
  return orders.reduce((sum, order) => sum + saleAmount(order), 0);
}

export function todaySalesOrders(orders: Order[], now = new Date()): Order[] {
  return filterSales(orders).filter((order) => isSameLocalDay(order.createdAt, now));
}
