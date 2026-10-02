import type { Order, OrderStatus } from "@/store/shop-types";
import { logger } from "@/server/logger";
import { notificationService } from "@/server/notifications/service";
import { enqueue } from "@/server/jobs/runner";

/** Fire-and-forget logistics status notification (never throws to callers). */
export async function notifyLogisticsStatusChange(order: Order, status: OrderStatus) {
  try {
    const email = order.customerEmail?.trim();
    if (!email) return;

    const subject = `Avyora order ${order.id} · ${status}`;
    const body = [
      `Your order ${order.id} is now ${status}.`,
      order.trackingId ? `Tracking: ${order.trackingId}.` : null,
      order.deliveryPartner ? `Courier: ${order.deliveryPartner}.` : null,
      "Thank you for shopping with Avyora.",
    ]
      .filter(Boolean)
      .join("\n");

    const notification = {
      event: `logistics.status.${status}`,
      recipient: email,
      subject,
      body,
      metadata: {
        orderId: order.id,
        status,
        trackingId: order.trackingId,
      },
    };

    // Prefer async job when runner is available; fall back to direct send.
    try {
      enqueue("notification-dispatch", { channel: "email", notification });
    } catch {
      await notificationService.send("email", notification);
    }
  } catch (error) {
    logger.warn("logistics.notify_failed", { orderId: order.id, error: String(error) });
  }
}
