import type { OrderStatus as PrismaOrderStatus, PaymentStatus as PrismaPaymentStatus, Prisma } from "@prisma/client";
import type { Order, OrderStatus } from "@/store/shop-types";
import { isCodPaymentMethod } from "@/lib/payment-method";
import { prisma } from "@/server/db";
import {
  inventoryHoldConfirmed,
  releaseInventoryHoldForOrder,
  restockConfirmedInventoryForOrder,
  stockLinesFromOrderItems,
} from "@/server/inventory/reservation";
import { logger } from "@/server/logger";

export function toPrismaOrderStatus(status: OrderStatus): PrismaOrderStatus | null {
  switch (status) {
    case "Pending Payment":
      return "PENDING_PAYMENT";
    case "Confirmed":
      return "CONFIRMED";
    case "Processing":
      return "PROCESSING";
    case "Packed":
      return "PACKED";
    case "Ready to Ship":
      return "READY_TO_SHIP";
    case "Shipped":
      return "SHIPPED";
    case "In Transit":
      return "IN_TRANSIT";
    case "Out for Delivery":
      return "OUT_FOR_DELIVERY";
    case "Delivered":
      return "DELIVERED";
    case "Cancelled":
      return "CANCELLED";
    case "Failed Delivery":
      return "FAILED_DELIVERY";
    case "Return Requested":
      return "RETURN_REQUESTED";
    case "Return Pickup":
      return "RETURN_PICKUP";
    case "Returned":
      return "RETURNED";
    case "RTO":
      return "RTO";
    case "Refunded":
      return "REFUNDED";
    default:
      return null;
  }
}

function toPrismaPaymentStatus(
  status: Order["paymentStatus"],
): PrismaPaymentStatus | null {
  switch (status) {
    case "Success":
      return "SUCCESS";
    case "Pending":
      return "PENDING";
    case "Failed":
      return "FAILED";
    case "Refunded":
      return "REFUNDED";
    case "Cancelled":
      return "FAILED";
    default:
      return null;
  }
}

async function restoreInventoryOnce(
  tx: Prisma.TransactionClient,
  orderId: string,
  reason: "logistics_return_restock" | "logistics_rto_restock" | "logistics_cancel_restock",
  actorEmail: string,
) {
  // Any prior idempotent restock/release for this order skips again.
  const priorTags = [
    `logistics_cancel_restock:${orderId}`,
    `logistics_return_restock:${orderId}`,
    `logistics_rto_restock:${orderId}`,
    `pending_payment_ttl_restock:${orderId}`,
    `order_release:${orderId}`,
    `order_cancel_restock:${orderId}`,
  ];
  const tagged = await tx.stockMovement.findFirst({
    where: { reason: { in: priorTags } },
  });
  if (tagged) return;

  const taggedReason = `${reason}:${orderId}`;
  const items = await tx.orderItem.findMany({ where: { orderId } });
  const lines = stockLinesFromOrderItems(items);
  const confirmed = await inventoryHoldConfirmed(tx, orderId);

  if (confirmed) {
    await restockConfirmedInventoryForOrder(tx, orderId, lines, {
      actorEmail,
      reasonTag: taggedReason,
      alsoSkipIfReasons: priorTags,
    });
  } else {
    // Still only a soft hold (e.g. cancelled before payment) — release reserved.
    await releaseInventoryHoldForOrder(tx, orderId, lines, {
      actorEmail,
      reasonTag: taggedReason,
      alsoSkipIfReasons: priorTags,
    });
  }
}

export function logisticsRestockReason(
  prismaStatus: PrismaOrderStatus,
): "logistics_return_restock" | "logistics_rto_restock" | "logistics_cancel_restock" | null {
  if (prismaStatus === "RTO") return "logistics_rto_restock";
  if (prismaStatus === "RETURNED") return "logistics_return_restock";
  if (prismaStatus === "CANCELLED") return "logistics_cancel_restock";
  return null;
}

export function shouldRestockOnLogisticsTransition(
  previousStatus: PrismaOrderStatus,
  prismaStatus: PrismaOrderStatus,
): boolean {
  if (previousStatus === prismaStatus) return false;
  if (!logisticsRestockReason(prismaStatus)) return false;
  if (
    previousStatus === "RETURNED" ||
    previousStatus === "RTO" ||
    previousStatus === "CANCELLED" ||
    previousStatus === "REFUNDED"
  ) {
    return false;
  }
  return true;
}

/**
 * Best-effort: push logistics commerce updates into Prisma so /track stays consistent.
 */
export async function syncLogisticsOrderToPrisma(order: Order, actorEmail: string) {
  try {
    const prismaStatus = toPrismaOrderStatus(order.status);
    if (!prismaStatus) return;

    const existing = await prisma.order.findFirst({
      where: {
        OR: [{ orderNumber: order.id }, { legacyId: order.id }, { id: order.id }],
      },
      include: {
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
        items: true,
      },
    });
    if (!existing) return;

    const paymentStatus = toPrismaPaymentStatus(order.paymentStatus);
    const previousStatus = existing.status;

    await prisma.$transaction(async (tx) => {
      const refundedAmount =
        typeof order.refundedAmount === "number" && order.refundedAmount > 0
          ? order.refundedAmount
          : undefined;

      if (existing.status !== prismaStatus) {
        const deliveredStamp =
          prismaStatus === "DELIVERED" && !existing.deliveredAt ? new Date() : undefined;
        await tx.order.update({
          where: { id: existing.id },
          data: {
            status: prismaStatus,
            trackingId: order.trackingId ?? existing.trackingId,
            notes: order.notes ?? existing.notes,
            cancelReason: order.cancelReason ?? existing.cancelReason,
            returnReason: order.returnReason ?? existing.returnReason,
            ...(refundedAmount != null ? { refundedAmount } : {}),
            ...(deliveredStamp ? { deliveredAt: deliveredStamp } : {}),
          },
        });
        if (deliveredStamp) {
          await tx.orderItem.updateMany({
            where: { orderId: existing.id, deliveredAt: null },
            data: { deliveredAt: deliveredStamp },
          });
        }
        await tx.orderStatusHistory.create({
          data: {
            orderId: existing.id,
            status: prismaStatus,
            note: `Logistics update by ${actorEmail}`,
            actorEmail,
          },
        });
      } else {
        await tx.order.update({
          where: { id: existing.id },
          data: {
            trackingId: order.trackingId ?? existing.trackingId,
            notes: order.notes ?? existing.notes,
            returnReason: order.returnReason ?? existing.returnReason,
            ...(refundedAmount != null ? { refundedAmount } : {}),
          },
        });
      }

      // Track return / refund records for admin visibility.
      if (
        prismaStatus === "RETURN_REQUESTED" ||
        prismaStatus === "RETURN_PICKUP" ||
        prismaStatus === "RETURNED"
      ) {
        const openReturn = await tx.return.findFirst({
          where: { orderId: existing.id, status: { not: "completed" } },
          orderBy: { createdAt: "desc" },
        });
        const returnStatus =
          prismaStatus === "RETURNED"
            ? "received"
            : prismaStatus === "RETURN_PICKUP"
              ? "pickup"
              : "requested";
        if (openReturn) {
          await tx.return.update({
            where: { id: openReturn.id },
            data: {
              status: returnStatus,
              reason: order.returnReason ?? openReturn.reason,
            },
          });
        } else {
          await tx.return.create({
            data: {
              orderId: existing.id,
              reason: order.returnReason || "Customer return",
              status: returnStatus,
            },
          });
        }
      }

      if (prismaStatus === "REFUNDED") {
        const amount = refundedAmount ?? Number(existing.total ?? 0);
        const existingRefund = await tx.refund.findFirst({
          where: { orderId: existing.id, status: "completed" },
        });
        if (!existingRefund) {
          await tx.refund.create({
            data: {
              orderId: existing.id,
              amount,
              reason: order.returnReason || "Logistics refund",
              status: "completed",
            },
          });
        }
        await tx.return.updateMany({
          where: { orderId: existing.id, status: { not: "completed" } },
          data: { status: "completed" },
        });
      }

      if (paymentStatus && existing.payments[0] && existing.payments[0].status !== paymentStatus) {
        // Logistics refunds and COD collection both update payment row.
        const allowPaymentUpdate =
          paymentStatus === "REFUNDED" ||
          isCodPaymentMethod(order.paymentMethod) ||
          existing.payments[0].provider === "cod";
        if (allowPaymentUpdate) {
          await tx.payment.update({
            where: { id: existing.payments[0].id },
            data: { status: paymentStatus, method: existing.payments[0].method ?? "cod" },
          });
        }
      }

      if (order.trackingId || order.deliveryPartner) {
        const shipment = await tx.shipment.findFirst({
          where: { orderId: existing.id },
          orderBy: { createdAt: "desc" },
        });
        if (shipment) {
          await tx.shipment.update({
            where: { id: shipment.id },
            data: {
              trackingNumber: order.trackingId ?? shipment.trackingNumber,
              courier: order.deliveryPartner ?? shipment.courier,
              status: prismaStatus,
            },
          });
        } else {
          await tx.shipment.create({
            data: {
              orderId: existing.id,
              trackingNumber: order.trackingId,
              courier: order.deliveryPartner,
              status: prismaStatus,
            },
          });
        }
      }

      // Idempotent restock when logistics marks Cancelled, Returned, or RTO.
      if (shouldRestockOnLogisticsTransition(previousStatus, prismaStatus)) {
        const reason = logisticsRestockReason(prismaStatus);
        if (reason) {
          await restoreInventoryOnce(tx, existing.id, reason, actorEmail);
        }
      }
    });
  } catch (error) {
    logger.warn("logistics.prisma_sync_failed", {
      orderId: order.id,
      error: String(error),
    });
  }
}
