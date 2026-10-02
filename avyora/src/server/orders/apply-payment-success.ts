import type { OrderStatus, Prisma } from "@prisma/client";
import { isCodPaymentMethod } from "@/lib/payment-method";
import {
  allocateInventoryAfterTtlRelease,
  confirmInventoryHoldForOrder,
  stockLinesFromOrderItems,
} from "@/server/inventory/reservation";
import { PENDING_PAYMENT_CANCEL_REASON } from "@/server/orders/release-pending-payment";

/** Keep CodDeliveryVerification in sync when doorstep UPI succeeds via verify/webhook. */
async function syncCodDoorstepUpiVerification(
  tx: Prisma.TransactionClient,
  params: {
    orderId: string;
    paymentId: string;
    paymentMethod: string | null | undefined;
    orderPaymentMethod: string | null | undefined;
    providerOrderId?: string | null;
    providerPaymentId: string;
  },
) {
  if (params.paymentMethod !== "upi_doorstep") return;
  if (!isCodPaymentMethod(params.orderPaymentMethod)) return;

  const cod = await tx.codDeliveryVerification.findUnique({ where: { orderId: params.orderId } });
  if (!cod || cod.cashCollectedAt || cod.collectionMethod === "CASH") return;

  await tx.codDeliveryVerification.update({
    where: { orderId: params.orderId },
    data: {
      collectionMethod: "UPI",
      upiPaymentId: params.paymentId,
      upiProviderOrderId: params.providerOrderId ?? cod.upiProviderOrderId,
      upiProviderPaymentId: params.providerPaymentId,
      upiVerifiedAt: cod.upiVerifiedAt ?? new Date(),
    },
  });

  // Drop pending COD cash ledger so only one SUCCESS payment remains.
  await tx.payment.updateMany({
    where: { orderId: params.orderId, provider: "cod", status: "PENDING" },
    data: { status: "FAILED" },
  });
}

const UNRESTOCK_ACTOR = "system:payment-success-reopen";

export function ttlUnrestockReasonTag(orderId: string): string {
  return `pending_payment_ttl_unrestock:${orderId}`;
}

export function isTtlAutoCancel(cancelReason: string | null | undefined): boolean {
  return cancelReason === PENDING_PAYMENT_CANCEL_REASON;
}

/**
 * Reverse soft-hold release from pending-payment TTL cancel so a late SUCCESS payment can fulfill.
 * Re-allocates sellable + on-hand (reserved was already cleared by TTL release).
 * Idempotent via unrestock movement tag.
 */
export async function undoTtlRestockForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const undoTag = ttlUnrestockReasonTag(orderId);
  const items = await tx.orderItem.findMany({ where: { orderId } });
  await allocateInventoryAfterTtlRelease(
    tx,
    orderId,
    stockLinesFromOrderItems(items),
    undoTag,
    UNRESTOCK_ACTOR,
  );
}

export type ApplyPaymentSuccessResult =
  | {
      ok: true;
      orderStatus: OrderStatus;
      reopenedFromTtl: boolean;
      alreadySuccess: boolean;
    }
  | {
      ok: false;
      reason: "payment_not_found" | "order_not_found" | "order_cancelled";
    };

/**
 * Mark Razorpay payment SUCCESS and align order status.
 * - PENDING_PAYMENT → PAYMENT_CONFIRMED
 * - CANCELLED by unpaid TTL → reopen, undo restock, PAYMENT_CONFIRMED
 * - CANCELLED for any other reason → reject (do not leave SUCCESS on cancelled order)
 */
export async function applyRazorpayPaymentSuccess(
  tx: Prisma.TransactionClient,
  params: {
    paymentId: string;
    orderId: string;
    providerOrderId?: string;
    providerPaymentId: string;
    note?: string;
  },
): Promise<ApplyPaymentSuccessResult> {
  const payment = await tx.payment.findUnique({ where: { id: params.paymentId } });
  if (!payment || payment.orderId !== params.orderId) {
    return { ok: false, reason: "payment_not_found" };
  }

  const order = await tx.order.findUnique({ where: { id: params.orderId } });
  if (!order) {
    return { ok: false, reason: "order_not_found" };
  }

  if (payment.status === "SUCCESS") {
    return {
      ok: true,
      orderStatus: order.status,
      reopenedFromTtl: false,
      alreadySuccess: true,
    };
  }

  if (order.status === "CANCELLED") {
    if (!isTtlAutoCancel(order.cancelReason)) {
      return { ok: false, reason: "order_cancelled" };
    }

    const claimed = await tx.order.updateMany({
      where: {
        id: order.id,
        status: "CANCELLED",
        cancelReason: PENDING_PAYMENT_CANCEL_REASON,
      },
      data: {
        status: "PAYMENT_CONFIRMED",
        cancelReason: null,
      },
    });

    if (claimed.count !== 1) {
      const latest = await tx.order.findUnique({ where: { id: order.id } });
      if (latest?.status === "PAYMENT_CONFIRMED" || latest?.status === "CONFIRMED") {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "SUCCESS",
            providerPaymentId: params.providerPaymentId,
            ...(params.providerOrderId ? { providerOrderId: params.providerOrderId } : {}),
          },
        });
        return {
          ok: true,
          orderStatus: latest.status,
          reopenedFromTtl: false,
          alreadySuccess: false,
        };
      }
      return { ok: false, reason: "order_cancelled" };
    }

    await undoTtlRestockForOrder(tx, order.id);

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "SUCCESS",
        providerPaymentId: params.providerPaymentId,
        ...(params.providerOrderId ? { providerOrderId: params.providerOrderId } : {}),
      },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        status: "PAYMENT_CONFIRMED",
        note:
          params.note ??
          "Razorpay payment verified after unpaid TTL cancel — order reopened",
        actorEmail: UNRESTOCK_ACTOR,
      },
    });

    return {
      ok: true,
      orderStatus: "PAYMENT_CONFIRMED",
      reopenedFromTtl: true,
      alreadySuccess: false,
    };
  }

  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: "SUCCESS",
      providerPaymentId: params.providerPaymentId,
      ...(params.providerOrderId ? { providerOrderId: params.providerOrderId } : {}),
    },
  });

  await syncCodDoorstepUpiVerification(tx, {
    orderId: order.id,
    paymentId: payment.id,
    paymentMethod: payment.method,
    orderPaymentMethod: order.paymentMethod,
    providerOrderId: params.providerOrderId ?? payment.providerOrderId,
    providerPaymentId: params.providerPaymentId,
  });

  if (order.status === "PENDING_PAYMENT") {
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: "PENDING_PAYMENT" },
      data: { status: "PAYMENT_CONFIRMED" },
    });
    if (claimed.count === 1) {
      const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
      await confirmInventoryHoldForOrder(
        tx,
        order.id,
        stockLinesFromOrderItems(items),
        undefined,
      );
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: "PAYMENT_CONFIRMED",
          note: params.note ?? "Razorpay payment verified",
        },
      });
    }
    const latest = await tx.order.findUnique({ where: { id: order.id } });
    return {
      ok: true,
      orderStatus: latest?.status ?? "PAYMENT_CONFIRMED",
      reopenedFromTtl: false,
      alreadySuccess: false,
    };
  }

  return {
    ok: true,
    orderStatus: order.status,
    reopenedFromTtl: false,
    alreadySuccess: false,
  };
}
