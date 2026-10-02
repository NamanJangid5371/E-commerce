import { z } from "zod";
import { prisma } from "@/server/db";
import {
  dbUnavailableError,
  HttpParseError,
  isDbUnavailable,
  jsonError,
  jsonOk,
  parseJson,
} from "@/server/http";
import { logger } from "@/server/logger";
import { verifyPaymentSignature } from "@/server/payments/razorpay";
import { applyRazorpayPaymentSuccess } from "@/server/orders/apply-payment-success";
import { mapPrismaOrderToClient, orderDetailInclude } from "@/server/orders/map-order";
import { mirrorClientOrderToCommerce } from "@/server/orders/mirror-commerce";

export const dynamic = "force-dynamic";

const verifySchema = z.object({
  orderId: z.string().min(1),
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const body = await parseJson(request, verifySchema);

    const valid = verifyPaymentSignature({
      orderId: body.razorpay_order_id,
      paymentId: body.razorpay_payment_id,
      signature: body.razorpay_signature,
    });

    if (!valid) {
      return jsonError("Invalid payment signature.", 400);
    }

    const order = await prisma.order.findFirst({
      where: {
        OR: [{ id: body.orderId }, { orderNumber: body.orderId }],
      },
      include: {
        payments: {
          where: { provider: "razorpay" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!order) {
      return jsonError("Order not found.", 404);
    }

    const payment = order.payments[0];
    if (!payment) {
      return jsonError("Payment record not found.", 404);
    }

    if (payment.status === "SUCCESS") {
      return jsonOk({
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: payment.status,
        alreadyVerified: true,
      });
    }

    const applied = await prisma.$transaction(async (tx) =>
      applyRazorpayPaymentSuccess(tx, {
        paymentId: payment.id,
        orderId: order.id,
        providerOrderId: body.razorpay_order_id,
        providerPaymentId: body.razorpay_payment_id,
        note: "Razorpay payment verified",
      }),
    );

    if (!applied.ok) {
      if (applied.reason === "order_cancelled") {
        logger.error("payments.razorpay.verify.cancelled_order", {
          orderId: order.id,
          orderNumber: order.orderNumber,
          paymentId: body.razorpay_payment_id,
        });
        return jsonError(
          "This order was cancelled. Your payment may still be captured — contact support for a refund.",
          409,
        );
      }
      return jsonError("Could not verify payment.", 400);
    }

    logger.info("payments.razorpay.verified", {
      orderId: order.id,
      orderNumber: order.orderNumber,
      paymentId: body.razorpay_payment_id,
      reopenedFromTtl: applied.reopenedFromTtl,
    });

    try {
      const fresh = await prisma.order.findUnique({
        where: { id: order.id },
        include: orderDetailInclude,
      });
      if (fresh) await mirrorClientOrderToCommerce(mapPrismaOrderToClient(fresh));
    } catch {
      /* mirror best-effort */
    }

    return jsonOk({
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: applied.orderStatus,
      paymentStatus: "SUCCESS",
      alreadyVerified: applied.alreadySuccess,
      reopenedFromTtl: applied.reopenedFromTtl,
    });
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    if (isDbUnavailable(error)) {
      logger.error("payments.razorpay.verify.db_unavailable", { error: String(error) });
      return dbUnavailableError();
    }
    logger.error("payments.razorpay.verify.failed", { error: String(error) });
    return jsonError("Could not verify payment.", 500);
  }
}
