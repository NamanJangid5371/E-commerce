import type { Order } from "@/store/shop-types";
import { mutateCommerce } from "@/server/commerce-db";
import { logger } from "@/server/logger";

/**
 * Best-effort Postgres → commerce.json mirror for UI warmth.
 * Never the reverse: JSON is not order SoT.
 */
export async function mirrorClientOrderToCommerce(order: Order) {
  try {
    await mutateCommerce((commerce) => {
      const without = commerce.orders.filter((entry) => entry.id !== order.id);
      return {
        ...commerce,
        orders: [order, ...without].sort(
          (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
        ),
      };
    });
  } catch (error) {
    logger.warn("sot.mirror_order_to_commerce_failed", {
      orderId: order.id,
      error: String(error),
    });
  }
}
