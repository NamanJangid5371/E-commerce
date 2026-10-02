import { formatINR } from "@/lib/format";
import { decimalToNumber } from "@/server/checkout/context";
import { prisma } from "@/server/db";
import { logger } from "@/server/logger";
import { notificationService } from "@/server/notifications/service";
import type { Order as PrismaOrder, OrderItem, Payment } from "@prisma/client";

type PaidCancelOrder = PrismaOrder & {
  items: OrderItem[];
  payments: Payment[];
  customer?: { user?: { email: string; name: string } | null } | null;
};

export type CancelRefundAlert = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  cancelReason: string | null;
  cancelledAt: string;
  amountDue: number;
  currency: string;
  paymentMethod: string | null;
  providerPaymentId: string | null;
  products: { name: string; sku: string; quantity: number; lineTotal: number }[];
};

function hasSuccessfulCapture(payments: Payment[]) {
  return payments.some((p) => p.status === "SUCCESS" || p.status === "PARTIALLY_REFUNDED");
}

function alreadyRefunded(order: PaidCancelOrder) {
  if (order.status === "REFUNDED") return true;
  const refundedAmount = decimalToNumber(order.refundedAmount);
  if (refundedAmount > 0 && refundedAmount >= decimalToNumber(order.total) - 0.01) return true;
  return order.payments.some((p) => p.status === "REFUNDED");
}

export function buildCancelRefundAlert(order: PaidCancelOrder): CancelRefundAlert | null {
  if (order.status !== "CANCELLED") return null;
  if (!hasSuccessfulCapture(order.payments)) return null;
  if (alreadyRefunded(order)) return null;

  const successPay =
    order.payments.find((p) => p.status === "SUCCESS") ??
    order.payments.find((p) => p.status === "PARTIALLY_REFUNDED");
  const email =
    order.customer?.user?.email?.trim() ||
    order.guestEmail?.trim() ||
    "unknown@customer";
  const name = order.customer?.user?.name?.trim() || email;

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: name,
    customerEmail: email,
    cancelReason: order.cancelReason,
    cancelledAt: order.updatedAt.toISOString(),
    amountDue: Math.max(0, decimalToNumber(order.total) - decimalToNumber(order.refundedAmount)),
    currency: successPay?.currency ?? "INR",
    paymentMethod: order.paymentMethod || successPay?.method || successPay?.provider || null,
    providerPaymentId: successPay?.providerPaymentId ?? successPay?.id ?? null,
    products: order.items.map((item) => ({
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      lineTotal: decimalToNumber(item.unitPrice) * item.quantity,
    })),
  };
}

async function resolveAdminNotifyEmails(): Promise<string[]> {
  const fromEnv = (
    process.env.ADMIN_REFUND_NOTIFY_EMAIL ||
    process.env.ADMIN_NOTIFY_EMAIL ||
    ""
  )
    .split(/[,;]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (fromEnv.length) return [...new Set(fromEnv)];

  try {
    const admins = await prisma.adminUser.findMany({
      where: { user: { active: true, deletedAt: null } },
      include: { user: { select: { email: true } } },
      take: 25,
    });
    const emails = admins
      .map((a) => a.user.email.trim().toLowerCase())
      .filter(Boolean);
    if (emails.length) return [...new Set(emails)];
  } catch {
    /* fall through */
  }

  return ["admin@avyora.com"];
}

/**
 * When a customer cancels an already-paid order, notify admins to release a refund
 * for that customer and the purchased products.
 */
export async function notifyAdminPaidOrderCancelRefund(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      payments: { orderBy: { createdAt: "desc" } },
      customer: { include: { user: { select: { email: true, name: true } } } },
    },
  });
  if (!order) return { notified: false as const, reason: "not_found" as const };

  const alert = buildCancelRefundAlert(order);
  if (!alert) {
    return { notified: false as const, reason: "not_paid_or_already_refunded" as const };
  }

  const productLines = alert.products
    .map((p) => `• ${p.name} (${p.sku}) ×${p.quantity} — ${formatINR(p.lineTotal)}`)
    .join("\n");

  const subject = `Refund required · ${alert.orderNumber} · ${formatINR(alert.amountDue)}`;
  const body = [
    "A customer cancelled a paid order. Please release the refund.",
    "",
    `Order: ${alert.orderNumber}`,
    `Customer: ${alert.customerName} <${alert.customerEmail}>`,
    `Amount to refund: ${formatINR(alert.amountDue)}`,
    `Payment: ${alert.paymentMethod ?? "—"}`,
    alert.providerPaymentId ? `Payment / txn ref: ${alert.providerPaymentId}` : null,
    alert.cancelReason ? `Cancel reason: ${alert.cancelReason}` : null,
    "",
    "Products:",
    productLines || "• (no line items)",
    "",
    "Open Admin → Payments (refund queue) or the order detail to process the refund.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  try {
    await prisma.auditLog.create({
      data: {
        actorEmail: alert.customerEmail,
        action: "ORDER_CANCEL_REFUND_REQUIRED",
        entity: "order",
        entityId: order.id,
        detail: `${alert.orderNumber}: refund ${formatINR(alert.amountDue)} for ${alert.customerEmail} — ${alert.products.map((p) => p.sku).join(", ")}`,
      },
    });
  } catch (error) {
    logger.warn("orders.cancel_refund_audit_failed", { orderId, error: String(error) });
  }

  const recipients = await resolveAdminNotifyEmails();
  let sent = 0;
  for (const recipient of recipients) {
    const result = await notificationService.send("email", {
      event: "order.cancel.refund_required",
      recipient,
      subject,
      body,
      metadata: {
        orderId: alert.orderId,
        orderNumber: alert.orderNumber,
        customerEmail: alert.customerEmail,
        customerName: alert.customerName,
        amountDue: alert.amountDue,
        products: alert.products,
        providerPaymentId: alert.providerPaymentId,
        cancelReason: alert.cancelReason,
      },
    });
    if (result.ok) sent += 1;
  }

  logger.info("orders.cancel_refund_notify", {
    orderId,
    orderNumber: alert.orderNumber,
    recipients: recipients.length,
    sent,
    amountDue: alert.amountDue,
  });

  return { notified: true as const, alert, recipients, sent };
}

/** Staff list: cancelled + paid orders still awaiting refund. */
export async function listPendingCancelRefundAlerts(limit = 50): Promise<CancelRefundAlert[]> {
  const rows = await prisma.order.findMany({
    where: {
      status: "CANCELLED",
      payments: { some: { status: { in: ["SUCCESS", "PARTIALLY_REFUNDED"] } } },
      NOT: {
        OR: [
          { payments: { some: { status: "REFUNDED" } } },
          { refunds: { some: { status: { in: ["completed", "initiated"] } } } },
        ],
      },
    },
    include: {
      items: true,
      payments: { orderBy: { createdAt: "desc" } },
      customer: { include: { user: { select: { email: true, name: true } } } },
    },
    orderBy: { updatedAt: "desc" },
    take: Math.min(100, Math.max(1, limit)),
  });

  return rows
    .map((row) => buildCancelRefundAlert(row))
    .filter((a): a is CancelRefundAlert => Boolean(a));
}
