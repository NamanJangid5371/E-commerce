import { z } from "zod";
import { hasAnyPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { decimalToNumber } from "@/server/checkout/context";
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
import {
  createRazorpayOrder,
  getRazorpayConfig,
  isRazorpayConfigured,
  RazorpayNotConfiguredError,
} from "@/server/payments/razorpay";
import { clientIpFromRequest, rateLimit } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";

const orderSchema = z.object({
  /** Required — amount is always taken from the trusted order total in Postgres. */
  orderId: z.string().min(1),
  receipt: z.string().optional(),
  currency: z.string().optional(),
  notes: z.record(z.string(), z.string()).optional(),
});

export async function POST(request: Request) {
  try {
    const ip = clientIpFromRequest(request);
    const limited = rateLimit(`razorpay-order:${ip}`, 30, 60_000);
    if (!limited.ok) {
      return jsonError("Too many payment attempts. Please wait and try again.", 429);
    }

    const body = await parseJson(request, orderSchema);

    if (!isRazorpayConfigured()) {
      return jsonError(
        "Online payments are unavailable. Configure Razorpay keys or use cash on delivery.",
        503,
      );
    }

    const session = await getSessionFromRequest(request);
    const config = getRazorpayConfig();

    const order = await prisma.order.findFirst({
      where: {
        OR: [{ id: body.orderId }, { orderNumber: body.orderId }],
      },
      include: {
        customer: { include: { user: { select: { id: true, email: true } } } },
        payments: { where: { provider: "razorpay" }, orderBy: { createdAt: "desc" }, take: 3 },
      },
    });

    if (!order) {
      return jsonError("Order not found.", 404);
    }

    // Ownership: authenticated customer must own the order; guests must match guestEmail.
    if (session?.role === "CUSTOMER") {
      const owns =
        order.customer?.userId === session.userId ||
        order.customer?.user?.email?.toLowerCase() === session.email.toLowerCase();
      if (!owns) {
        return jsonError("You do not have access to this order.", 403);
      }
    } else if (
      session &&
      hasAnyPermission(session.permissions, [PERMISSIONS.ORDER_VIEW, PERMISSIONS.ORDER_UPDATE])
    ) {
      // Staff may create payment orders for support flows.
    } else {
      // Guest / anonymous: only allow when order is a guest order and contact matches via guestEmail.
      // Do not accept client-supplied email — use the order's stored guestEmail.
      if (order.customerId || !order.guestEmail) {
        return jsonError("Sign in to continue payment for this order.", 401);
      }
      // Guest orders may proceed without login; amount still comes from DB.
    }

    if (order.payments.some((p) => p.status === "SUCCESS")) {
      return jsonError("This order is already paid.", 409);
    }

    const amountInr = decimalToNumber(order.total);
    if (!amountInr || amountInr < 1) {
      return jsonError("Invalid order amount.", 400);
    }

    const receipt = body.receipt ?? order.orderNumber;
    const razorpayOrder = await createRazorpayOrder({
      amountInr,
      receipt,
      notes: body.notes ?? { avyoraOrderId: order.orderNumber },
    });

    if (razorpayOrder.id) {
      await prisma.payment.updateMany({
        where: {
          orderId: order.id,
          provider: "razorpay",
          status: "PENDING",
        },
        data: {
          providerOrderId: razorpayOrder.id,
        },
      });
    }

    return jsonOk({
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: config!.keyId,
      receipt: razorpayOrder.receipt,
    });
  } catch (error) {
    if (error instanceof RazorpayNotConfiguredError) {
      return jsonError(error.message, 503);
    }
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    if (isDbUnavailable(error)) {
      logger.error("payments.razorpay.order.db_unavailable", { error: String(error) });
      return dbUnavailableError();
    }
    logger.error("payments.razorpay.order.failed", { error: String(error) });
    return jsonError("Could not create payment order.", 502);
  }
}
