import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import {
  dbUnavailableError,
  isDbUnavailable,
  jsonError,
  jsonOk,
} from "@/server/http";
import { logger } from "@/server/logger";
import { verifyWebhookSignature } from "@/server/payments/razorpay";
import { applyRazorpayPaymentSuccess } from "@/server/orders/apply-payment-success";
import { mapPrismaOrderToClient, orderDetailInclude } from "@/server/orders/map-order";
import { mirrorClientOrderToCommerce } from "@/server/orders/mirror-commerce";

export const dynamic = "force-dynamic";

type RazorpayWebhookPayload = {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        status?: string;
      };
    };
  };
};

async function resolvePayment(providerPaymentId?: string, providerOrderId?: string) {
  if (providerPaymentId) {
    const byPaymentId = await prisma.payment.findFirst({
      where: { providerPaymentId },
      include: { order: true },
      orderBy: { createdAt: "desc" },
    });
    if (byPaymentId) return byPaymentId;
  }

  if (providerOrderId) {
    const byOrderId = await prisma.payment.findFirst({
      where: { providerOrderId },
      include: { order: true },
      orderBy: { createdAt: "desc" },
    });
    if (byOrderId) return byOrderId;
  }

  return null;
}

async function markPaymentSuccess(
  paymentId: string,
  orderId: string,
  providerPaymentId: string,
) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status === "SUCCESS") return;

  const applied = await prisma.$transaction(async (tx) =>
    applyRazorpayPaymentSuccess(tx, {
      paymentId,
      orderId,
      providerPaymentId,
      note: "Razorpay webhook: payment.captured",
    }),
  );

  if (!applied.ok) {
    logger.error("payments.razorpay.webhook.payment_not_applied", {
      paymentId,
      orderId,
      providerPaymentId,
      reason: applied.reason,
    });
    return;
  }

  if (applied.reopenedFromTtl) {
    logger.info("payments.razorpay.webhook.reopened_ttl_cancel", {
      paymentId,
      orderId,
      providerPaymentId,
    });
  }

  try {
    const fresh = await prisma.order.findUnique({
      where: { id: orderId },
      include: orderDetailInclude,
    });
    if (fresh) await mirrorClientOrderToCommerce(mapPrismaOrderToClient(fresh));
  } catch {
    /* mirror best-effort */
  }
}

async function markPaymentFailed(paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status === "SUCCESS") return;

  await prisma.payment.update({
    where: { id: paymentId },
    data: { status: "FAILED" },
  });
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature") ?? "";

    if (!verifyWebhookSignature(rawBody, signature)) {
      return jsonError("Invalid webhook signature.", 401);
    }

    let payload: RazorpayWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as RazorpayWebhookPayload;
    } catch {
      return jsonError("Invalid webhook payload.", 400);
    }

    const eventType = payload.event ?? "unknown";
    const paymentEntity = payload.payload?.payment?.entity;
    const providerPaymentId = paymentEntity?.id;
    const providerOrderId = paymentEntity?.order_id;
    const providerEventId =
      request.headers.get("x-razorpay-event-id") ??
      `${eventType}:${providerPaymentId ?? providerOrderId ?? "unknown"}`;

    const payment = await resolvePayment(providerPaymentId, providerOrderId);

    if (!payment) {
      logger.warn("payments.razorpay.webhook.payment_not_found", {
        providerPaymentId,
        providerOrderId,
        eventType,
      });
      return jsonOk({ received: true, matched: false });
    }

    const existingEvent = await prisma.paymentEvent.findUnique({
      where: { providerEventId },
    });
    if (existingEvent) {
      return jsonOk({ received: true, duplicate: true });
    }

    await prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        eventType,
        providerEventId,
        payload: payload as Prisma.InputJsonValue,
        processed: false,
      },
    });

    if (eventType === "payment.captured" && providerPaymentId) {
      await markPaymentSuccess(payment.id, payment.orderId, providerPaymentId);
    } else if (eventType === "payment.failed") {
      await markPaymentFailed(payment.id);
    }

    await prisma.paymentEvent.updateMany({
      where: { providerEventId },
      data: { processed: true },
    });

    return jsonOk({ received: true, event: eventType });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonOk({ received: true, duplicate: true });
    }
    if (isDbUnavailable(error)) {
      logger.error("payments.razorpay.webhook.db_unavailable", { error: String(error) });
      return dbUnavailableError();
    }
    logger.error("payments.razorpay.webhook.failed", { error: String(error) });
    return jsonError("Webhook processing failed.", 500);
  }
}
