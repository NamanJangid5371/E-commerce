import type { CodCollectionMethod, CodDeliveryVerification, Order as PrismaOrder, Payment } from "@prisma/client";
import { prisma } from "@/server/db";
import { isCodPaymentMethod } from "@/lib/payment-method";
import { deliveryOtpEmail, isSmtpConfigured, sendMail } from "@/lib/mail";
import { formatINR } from "@/lib/format";
import { logger } from "@/server/logger";
import { decimalToNumber } from "@/server/checkout/context";
import {
  codDeliveryOtpMaxAttempts,
  codDeliveryOtpTtlMinutes,
  deliveryOtpExpiryDate,
  generateDeliveryOtpCode,
  hashDeliveryOtp,
  verifyDeliveryOtpHash,
} from "@/server/cod/otp";
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  verifyPaymentSignature,
} from "@/server/payments/razorpay";
import { mapPrismaOrderToClient, orderDetailInclude } from "@/server/orders/map-order";
import { mirrorClientOrderToCommerce } from "@/server/orders/mirror-commerce";
import { applyOrderStatusUpdate } from "@/lib/logistics-orders";
import { findOpsOrder, persistOrder } from "@/server/logistics/mutations";
import { notifyLogisticsStatusChange } from "@/server/logistics/notify";
import type { Order as ClientOrder } from "@/store/shop-types";

const PARTNER_HANDOFF_STATUSES = new Set([
  "Ready to Ship",
  "Shipped",
  "In Transit",
  "Out for Delivery",
  "Failed Delivery",
]);

type OrderWithCod = PrismaOrder & {
  payments: Payment[];
  customer?: { user?: { email: string; name: string } | null } | null;
  codDelivery?: CodDeliveryVerification | null;
};

export type CodDeliveryDto = {
  otpSentAt: string | null;
  otpExpiresAt: string | null;
  otpVerifiedAt: string | null;
  otpVerified: boolean;
  collectionMethod: "cash" | "upi" | null;
  cashCollectedAt: string | null;
  cashCollectedBy: string | null;
  upiVerifiedAt: string | null;
  upiProviderPaymentId: string | null;
  upiProviderOrderId: string | null;
  paymentPaid: boolean;
  canCompleteDelivery: boolean;
  blockingReason: string | null;
};

function serializeCod(row: CodDeliveryVerification | null | undefined, paymentPaid: boolean): CodDeliveryDto {
  const otpVerified = Boolean(row?.otpVerifiedAt);
  const cashOk = row?.collectionMethod === "CASH" && Boolean(row.cashCollectedAt);
  const upiOk = row?.collectionMethod === "UPI" && Boolean(row.upiVerifiedAt);
  const paid = paymentPaid || cashOk || upiOk;
  let blockingReason: string | null = null;
  if (!otpVerified) blockingReason = "Delivery OTP is not verified.";
  else if (!paid) blockingReason = "Collect cash or complete doorstep UPI before marking delivered.";
  return {
    otpSentAt: row?.otpSentAt?.toISOString() ?? null,
    otpExpiresAt: row?.otpExpiresAt?.toISOString() ?? null,
    otpVerifiedAt: row?.otpVerifiedAt?.toISOString() ?? null,
    otpVerified,
    collectionMethod: row?.collectionMethod === "CASH" ? "cash" : row?.collectionMethod === "UPI" ? "upi" : null,
    cashCollectedAt: row?.cashCollectedAt?.toISOString() ?? null,
    cashCollectedBy: row?.cashCollectedBy ?? null,
    upiVerifiedAt: row?.upiVerifiedAt?.toISOString() ?? null,
    upiProviderPaymentId: row?.upiProviderPaymentId ?? null,
    upiProviderOrderId: row?.upiProviderOrderId ?? null,
    paymentPaid: paid,
    canCompleteDelivery: otpVerified && paid,
    blockingReason,
  };
}

async function loadCodOrder(orderIdOrNumber: string): Promise<OrderWithCod | null> {
  return prisma.order.findFirst({
    where: {
      OR: [{ id: orderIdOrNumber }, { orderNumber: orderIdOrNumber }, { legacyId: orderIdOrNumber }],
    },
    include: {
      payments: { orderBy: { createdAt: "desc" } },
      customer: { include: { user: { select: { email: true, name: true } } } },
      codDelivery: true,
    },
  });
}

function customerEmail(order: OrderWithCod): string | null {
  return order.customer?.user?.email?.trim() || order.guestEmail?.trim() || null;
}

function customerName(order: OrderWithCod): string {
  return order.customer?.user?.name?.trim() || "Customer";
}

function hasSuccessfulPayment(order: OrderWithCod): boolean {
  return order.payments.some((p) => p.status === "SUCCESS");
}

export async function getCodDeliveryState(orderIdOrNumber: string) {
  const order = await loadCodOrder(orderIdOrNumber);
  if (!order) return { ok: false as const, message: "Order not found.", status: 404 as const };
  if (!isCodPaymentMethod(order.paymentMethod)) {
    return { ok: false as const, message: "Not a COD order.", status: 400 as const };
  }
  return {
    ok: true as const,
    order,
    cod: serializeCod(order.codDelivery, hasSuccessfulPayment(order)),
  };
}

/** Put the job Out for Delivery when the partner starts doorstep work (no manual status buttons). */
async function ensureOutForDeliveryForPartner(
  orderIdOrNumber: string,
  actorEmail: string,
): Promise<{ ok: true; order: ClientOrder } | { ok: false; message: string }> {
  const { order } = await findOpsOrder(orderIdOrNumber);
  if (!order) return { ok: false, message: "Order not found." };
  if (order.status === "Out for Delivery") return { ok: true, order };
  if (order.status === "Delivered") return { ok: true, order };
  if (!PARTNER_HANDOFF_STATUSES.has(order.status)) {
    return {
      ok: false,
      message: `Cannot start doorstep delivery from ${order.status}. Warehouse must pack and assign the partner first.`,
    };
  }
  const next = applyOrderStatusUpdate(order, "Out for Delivery", {
    note: "Out for delivery — partner started doorstep verification",
    location: order.address.city,
    updatedBy: actorEmail,
  }).order;
  const saved = await persistOrder(order.id, next, actorEmail);
  void notifyLogisticsStatusChange(saved, "Out for Delivery");
  return { ok: true, order: saved };
}

/** Issue / rotate delivery OTP when partner starts doorstep COD (auto OFD if needed). */
export async function issueCodDeliveryOtp(orderIdOrNumber: string, opts?: { force?: boolean }) {
  const handoff = await ensureOutForDeliveryForPartner(orderIdOrNumber, "system:cod-otp");
  if (!handoff.ok) {
    return { ok: false as const, message: handoff.message, status: 409 as const };
  }

  const order = await loadCodOrder(orderIdOrNumber);
  if (!order) return { ok: false as const, message: "Order not found.", status: 404 as const };
  if (!isCodPaymentMethod(order.paymentMethod)) {
    return { ok: false as const, message: "Delivery OTP applies only to COD orders.", status: 400 as const };
  }
  if (order.status !== "OUT_FOR_DELIVERY" && order.status !== "FAILED_DELIVERY") {
    return {
      ok: false as const,
      message: "Delivery OTP is issued when the order is out for delivery.",
      status: 409 as const,
    };
  }
  // Never clear a successful OTP verification — resend only rotates unverified codes.
  if (order.codDelivery?.otpVerifiedAt) {
    return {
      ok: true as const,
      alreadyVerified: true as const,
      cod: serializeCod(order.codDelivery, hasSuccessfulPayment(order)),
    };
  }

  const email = customerEmail(order);
  if (!email) {
    return { ok: false as const, message: "No customer email on order for OTP delivery.", status: 409 as const };
  }

  const code = generateDeliveryOtpCode();
  const now = new Date();
  const expiresAt = deliveryOtpExpiryDate(now);
  const otpHash = hashDeliveryOtp(code, order.id);

  const row = await prisma.codDeliveryVerification.upsert({
    where: { orderId: order.id },
    create: {
      orderId: order.id,
      otpHash,
      otpExpiresAt: expiresAt,
      otpSentAt: now,
      otpAttempts: 0,
      otpVerifiedAt: null,
    },
    update: {
      otpHash,
      otpExpiresAt: expiresAt,
      otpSentAt: now,
      otpAttempts: 0,
      otpVerifiedAt: null,
    },
  });

  const mail = deliveryOtpEmail({
    name: customerName(order),
    orderNumber: order.orderNumber,
    code,
    expiresMinutes: codDeliveryOtpTtlMinutes(),
    amountLabel: formatINR(decimalToNumber(order.total)),
  });

  if (isSmtpConfigured()) {
    try {
      await sendMail({ to: email, subject: mail.subject, text: mail.text, html: mail.html });
    } catch (error) {
      logger.error("cod.otp_email_failed", { orderId: order.id, error: String(error) });
      return { ok: false as const, message: "Could not send delivery OTP email.", status: 502 as const };
    }
  } else {
    logger.warn("cod.otp_email_skipped_no_smtp", { orderId: order.id, codeDevOnly: code });
  }

  logger.info("cod.otp_issued", { orderId: order.id, orderNumber: order.orderNumber, expiresAt });
  return {
    ok: true as const,
    alreadyVerified: false as const,
    cod: serializeCod(row, hasSuccessfulPayment(order)),
    /** Only returned when SMTP is not configured (local/dev). */
    devCode: isSmtpConfigured() ? undefined : code,
  };
}

export async function verifyCodDeliveryOtp(orderIdOrNumber: string, code: string) {
  const order = await loadCodOrder(orderIdOrNumber);
  if (!order) return { ok: false as const, message: "Order not found.", status: 404 as const };
  if (!isCodPaymentMethod(order.paymentMethod)) {
    return { ok: false as const, message: "Not a COD order.", status: 400 as const };
  }

  const session = order.codDelivery;
  if (!session?.otpHash || !session.otpExpiresAt) {
    return { ok: false as const, message: "No delivery OTP has been issued for this order.", status: 409 as const };
  }
  if (session.otpVerifiedAt) {
    const paid = hasSuccessfulPayment(order);
    const cod = serializeCod(session, paid);
    const auto = paid
      ? await autoMarkDeliveredAfterCodReady(orderIdOrNumber, "system:cod-otp")
      : { autoDelivered: false as const };
    return {
      ok: true as const,
      alreadyVerified: true as const,
      cod: auto.clientOrder?.codDelivery ?? cod,
      autoDelivered: auto.autoDelivered,
    };
  }
  if (session.otpAttempts >= codDeliveryOtpMaxAttempts()) {
    return { ok: false as const, message: "Too many OTP attempts. Resend a new delivery code.", status: 429 as const };
  }
  if (session.otpExpiresAt.getTime() < Date.now()) {
    return { ok: false as const, message: "Delivery OTP has expired. Resend a new code.", status: 409 as const };
  }

  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) {
    return { ok: false as const, message: "Enter the 6-digit delivery code.", status: 400 as const };
  }

  const valid = verifyDeliveryOtpHash(normalized, order.id, session.otpHash);
  if (!valid) {
    const updated = await prisma.codDeliveryVerification.update({
      where: { orderId: order.id },
      data: { otpAttempts: { increment: 1 } },
    });
    const remaining = Math.max(0, codDeliveryOtpMaxAttempts() - updated.otpAttempts);
    return {
      ok: false as const,
      message: remaining
        ? `Invalid delivery OTP. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
        : "Too many OTP attempts. Resend a new delivery code.",
      status: remaining ? (400 as const) : (429 as const),
    };
  }

  const row = await prisma.codDeliveryVerification.update({
    where: { orderId: order.id },
    data: {
      otpVerifiedAt: new Date(),
      // Invalidate reuse of the same code hash after success.
      otpHash: null,
    },
  });

  await prisma.orderStatusHistory.create({
    data: {
      orderId: order.id,
      status: order.status,
      note: "COD delivery OTP verified",
      actorEmail: "system:cod-otp",
    },
  });

  const paid = hasSuccessfulPayment(order);
  const auto = paid
    ? await autoMarkDeliveredAfterCodReady(orderIdOrNumber, "system:cod-otp")
    : { autoDelivered: false as const };

  return {
    ok: true as const,
    alreadyVerified: false as const,
    cod: auto.clientOrder?.codDelivery ?? serializeCod(row, paid),
    autoDelivered: auto.autoDelivered,
  };
}

async function mirrorOrder(orderId: string) {
  try {
    const fresh = await prisma.order.findUnique({
      where: { id: orderId },
      include: { ...orderDetailInclude, codDelivery: true },
    });
    if (fresh) await mirrorClientOrderToCommerce(mapPrismaOrderToClient(fresh));
  } catch (error) {
    logger.warn("cod.mirror_failed", { orderId, error: String(error) });
  }
}

/**
 * When OTP is verified and payment is confirmed, mark Delivered automatically.
 * No manual "Mark delivered" step — applies from partner last-mile statuses.
 */
async function autoMarkDeliveredAfterCodReady(
  orderIdOrNumber: string,
  actorEmail: string,
): Promise<{ autoDelivered: boolean; clientOrder?: ClientOrder }> {
  const gate = await assertCodDeliveryCompletable(orderIdOrNumber);
  if (!gate.ok) return { autoDelivered: false };

  const { order } = await findOpsOrder(orderIdOrNumber);
  if (!order) return { autoDelivered: false };
  if (order.status === "Delivered") {
    return { autoDelivered: true, clientOrder: await attachCodToClientOrder(order) };
  }
  if (!PARTNER_HANDOFF_STATUSES.has(order.status)) {
    logger.info("cod.auto_deliver_skip_status", {
      orderId: order.id,
      status: order.status,
    });
    return { autoDelivered: false };
  }

  const next = applyOrderStatusUpdate(
    { ...order, paymentStatus: "Success" },
    "Delivered",
    {
      note: "Auto-delivered — COD OTP verified and payment confirmed",
      location: order.address.city,
      updatedBy: actorEmail,
    },
  ).order;

  const saved = await persistOrder(order.id, { ...next, paymentStatus: "Success" }, actorEmail);
  void notifyLogisticsStatusChange(saved, "Delivered");
  logger.info("cod.auto_delivered", { orderId: order.id, actorEmail });
  return { autoDelivered: true, clientOrder: await attachCodToClientOrder(saved) };
}

/** Record COD cash collection — mutually exclusive with UPI. Requires verified OTP. */
export async function markCodCashCollected(orderIdOrNumber: string, actorEmail: string) {
  const order = await loadCodOrder(orderIdOrNumber);
  if (!order) return { ok: false as const, message: "Order not found.", status: 404 as const };
  if (!isCodPaymentMethod(order.paymentMethod)) {
    return { ok: false as const, message: "COD collection is only for cash-on-delivery orders.", status: 400 as const };
  }
  if (!order.codDelivery?.otpVerifiedAt) {
    return { ok: false as const, message: "Verify the delivery OTP before collecting cash.", status: 409 as const };
  }
  if (order.codDelivery.collectionMethod === "UPI" || order.codDelivery.upiVerifiedAt) {
    return { ok: false as const, message: "UPI already verified for this order. Cash is not required.", status: 409 as const };
  }
  if (hasSuccessfulPayment(order) || order.codDelivery.collectionMethod === "CASH") {
    const auto = await autoMarkDeliveredAfterCodReady(orderIdOrNumber, actorEmail);
    return {
      ok: true as const,
      alreadyCollected: true as const,
      cod: auto.clientOrder?.codDelivery ?? serializeCod(order.codDelivery, true),
      autoDelivered: auto.autoDelivered,
    };
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.codDeliveryVerification.findUnique({ where: { orderId: order.id } });
    if (!locked?.otpVerifiedAt) throw new Error("Delivery OTP is not verified.");
    if (locked.collectionMethod === "UPI" || locked.upiVerifiedAt) {
      throw new Error("UPI already verified for this order.");
    }
    if (locked.collectionMethod === "CASH" && locked.cashCollectedAt) {
      return locked;
    }

    const successPay = await tx.payment.findFirst({
      where: { orderId: order.id, status: "SUCCESS" },
    });
    if (successPay) throw new Error("Order already has a successful payment.");

    const pendingCod = await tx.payment.findFirst({
      where: { orderId: order.id, provider: "cod", status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });

    if (pendingCod) {
      await tx.payment.update({
        where: { id: pendingCod.id },
        data: { status: "SUCCESS", method: "cod_cash" },
      });
      await tx.paymentEvent.create({
        data: {
          paymentId: pendingCod.id,
          eventType: "COD_CASH_COLLECTED",
          providerEventId: `cod-cash:${order.id}:${now.getTime()}`,
          payload: { actorEmail, at: now.toISOString() },
          processed: true,
        },
      });
    } else {
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          provider: "cod",
          amount: order.total,
          currency: "INR",
          status: "SUCCESS",
          method: "cod_cash",
        },
      });
      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          eventType: "COD_CASH_COLLECTED",
          providerEventId: `cod-cash:${order.id}:${now.getTime()}`,
          payload: { actorEmail, at: now.toISOString() },
          processed: true,
        },
      });
    }

    const row = await tx.codDeliveryVerification.update({
      where: { orderId: order.id },
      data: {
        collectionMethod: "CASH",
        cashCollectedAt: now,
        cashCollectedBy: actorEmail,
      },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        status: order.status,
        note: "COD_CASH_COLLECTED — payment marked PAID",
        actorEmail,
      },
    });

    return row;
  });

  await mirrorOrder(order.id);
  const auto = await autoMarkDeliveredAfterCodReady(orderIdOrNumber, actorEmail);
  return {
    ok: true as const,
    alreadyCollected: false as const,
    cod: auto.clientOrder?.codDelivery ?? serializeCod(result, true),
    autoDelivered: auto.autoDelivered,
  };
}

/** Create Razorpay order for doorstep UPI on a COD shipment. */
export async function createCodDoorstepUpiOrder(orderIdOrNumber: string, actorEmail: string) {
  const order = await loadCodOrder(orderIdOrNumber);
  if (!order) return { ok: false as const, message: "Order not found.", status: 404 as const };
  if (!isCodPaymentMethod(order.paymentMethod)) {
    return { ok: false as const, message: "Doorstep UPI is only for COD orders.", status: 400 as const };
  }
  if (!order.codDelivery?.otpVerifiedAt) {
    return { ok: false as const, message: "Verify the delivery OTP before starting UPI.", status: 409 as const };
  }
  if (order.codDelivery.collectionMethod === "CASH" || order.codDelivery.cashCollectedAt) {
    return { ok: false as const, message: "Cash already collected. UPI is not required.", status: 409 as const };
  }
  if (hasSuccessfulPayment(order) || order.codDelivery.upiVerifiedAt) {
    return { ok: false as const, message: "Payment already completed for this order.", status: 409 as const };
  }
  if (!isRazorpayConfigured()) {
    return { ok: false as const, message: "Razorpay is not configured for doorstep UPI.", status: 503 as const };
  }

  const amountInr = decimalToNumber(order.total);
  const razorpayOrder = await createRazorpayOrder({
    amountInr,
    receipt: `cod-${order.orderNumber}`.slice(0, 40),
    notes: {
      avyoraOrderId: order.id,
      orderNumber: order.orderNumber,
      purpose: "cod_doorstep_upi",
      actorEmail,
    },
  });

  const payment = await prisma.$transaction(async (tx) => {
    const locked = await tx.codDeliveryVerification.findUnique({ where: { orderId: order.id } });
    if (!locked?.otpVerifiedAt) throw new Error("Delivery OTP is not verified.");
    if (locked.collectionMethod === "CASH") throw new Error("Cash already collected.");
    if (await tx.payment.findFirst({ where: { orderId: order.id, status: "SUCCESS" } })) {
      throw new Error("Order already paid.");
    }

    // Prefer updating an existing pending razorpay doorstep row; else create.
    const existing = await tx.payment.findFirst({
      where: { orderId: order.id, provider: "razorpay", method: "upi_doorstep", status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });

    const row = existing
      ? await tx.payment.update({
          where: { id: existing.id },
          data: {
            providerOrderId: razorpayOrder.id,
            amount: order.total,
            method: "upi_doorstep",
          },
        })
      : await tx.payment.create({
          data: {
            orderId: order.id,
            provider: "razorpay",
            providerOrderId: razorpayOrder.id,
            amount: order.total,
            currency: "INR",
            status: "PENDING",
            method: "upi_doorstep",
          },
        });

    await tx.codDeliveryVerification.update({
      where: { orderId: order.id },
      data: {
        upiPaymentId: row.id,
        upiProviderOrderId: razorpayOrder.id,
      },
    });

    return row;
  });

  return {
    ok: true as const,
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    paymentId: payment.id,
    keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID || "",
    orderNumber: order.orderNumber,
  };
}

/** Verify doorstep UPI payment signature and mark PAID (exclusive of cash). */
export async function verifyCodDoorstepUpi(input: {
  orderIdOrNumber: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  actorEmail: string;
}) {
  const order = await loadCodOrder(input.orderIdOrNumber);
  if (!order) return { ok: false as const, message: "Order not found.", status: 404 as const };
  if (!isCodPaymentMethod(order.paymentMethod)) {
    return { ok: false as const, message: "Not a COD order.", status: 400 as const };
  }
  if (!order.codDelivery?.otpVerifiedAt) {
    return { ok: false as const, message: "Verify the delivery OTP before UPI confirmation.", status: 409 as const };
  }
  if (order.codDelivery.collectionMethod === "CASH" || order.codDelivery.cashCollectedAt) {
    return { ok: false as const, message: "Cash already collected. UPI cannot be applied.", status: 409 as const };
  }

  const valid = verifyPaymentSignature({
    orderId: input.razorpay_order_id,
    paymentId: input.razorpay_payment_id,
    signature: input.razorpay_signature,
  });
  if (!valid) {
    return { ok: false as const, message: "Invalid UPI payment signature.", status: 400 as const };
  }

  const payment = order.payments.find(
    (p) =>
      p.provider === "razorpay" &&
      (p.providerOrderId === input.razorpay_order_id || p.id === order.codDelivery?.upiPaymentId),
  );
  if (!payment) {
    return { ok: false as const, message: "Doorstep UPI payment record not found.", status: 404 as const };
  }
  if (payment.providerOrderId && payment.providerOrderId !== input.razorpay_order_id) {
    return { ok: false as const, message: "Razorpay order does not match this COD shipment.", status: 409 as const };
  }

  if (payment.status === "SUCCESS" && order.codDelivery.upiVerifiedAt) {
    const auto = await autoMarkDeliveredAfterCodReady(input.orderIdOrNumber, input.actorEmail);
    return {
      ok: true as const,
      alreadyVerified: true as const,
      cod: auto.clientOrder?.codDelivery ?? serializeCod(order.codDelivery, true),
      autoDelivered: auto.autoDelivered,
    };
  }

  const now = new Date();
  try {
    const row = await prisma.$transaction(async (tx) => {
      const locked = await tx.codDeliveryVerification.findUnique({ where: { orderId: order.id } });
      if (!locked?.otpVerifiedAt) throw new Error("Delivery OTP is not verified.");
      if (locked.collectionMethod === "CASH" || locked.cashCollectedAt) {
        throw new Error("Cash already collected for this order.");
      }

      const otherSuccess = await tx.payment.findFirst({
        where: { orderId: order.id, status: "SUCCESS", NOT: { id: payment.id } },
      });
      if (otherSuccess) throw new Error("Another successful payment already exists.");

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "SUCCESS",
          providerOrderId: input.razorpay_order_id,
          providerPaymentId: input.razorpay_payment_id,
          method: "upi_doorstep",
        },
      });

      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          eventType: "COD_UPI_VERIFIED",
          providerEventId: `cod-upi:${input.razorpay_payment_id}`,
          payload: {
            actorEmail: input.actorEmail,
            razorpay_order_id: input.razorpay_order_id,
            razorpay_payment_id: input.razorpay_payment_id,
          },
          processed: true,
        },
      });

      // Cancel pending COD cash payment rows so only one SUCCESS remains.
      await tx.payment.updateMany({
        where: { orderId: order.id, provider: "cod", status: "PENDING" },
        data: { status: "FAILED" },
      });

      return tx.codDeliveryVerification.update({
        where: { orderId: order.id },
        data: {
          collectionMethod: "UPI" satisfies CodCollectionMethod,
          upiPaymentId: payment.id,
          upiProviderOrderId: input.razorpay_order_id,
          upiProviderPaymentId: input.razorpay_payment_id,
          upiVerifiedAt: now,
        },
      });
    });

    await prisma.orderStatusHistory.create({
      data: {
        orderId: order.id,
        status: order.status,
        note: `COD UPI verified · ${input.razorpay_payment_id}`,
        actorEmail: input.actorEmail,
      },
    });

    await mirrorOrder(order.id);
    const auto = await autoMarkDeliveredAfterCodReady(input.orderIdOrNumber, input.actorEmail);
    return {
      ok: true as const,
      alreadyVerified: false as const,
      cod: auto.clientOrder?.codDelivery ?? serializeCod(row, true),
      autoDelivered: auto.autoDelivered,
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "Could not verify doorstep UPI.",
      status: 409 as const,
    };
  }
}

export async function assertCodDeliveryCompletable(orderIdOrNumber: string) {
  const order = await loadCodOrder(orderIdOrNumber);
  if (!order) return { ok: false as const, message: "Order not found." };
  if (!isCodPaymentMethod(order.paymentMethod)) return { ok: true as const };
  const cod = serializeCod(order.codDelivery, hasSuccessfulPayment(order));
  if (!cod.canCompleteDelivery) {
    return { ok: false as const, message: cod.blockingReason || "COD delivery requirements not met." };
  }
  return { ok: true as const, cod };
}

export async function attachCodToClientOrder<T extends { id: string; paymentMethod?: string | null }>(
  clientOrder: T,
): Promise<T & { codDelivery?: CodDeliveryDto }> {
  if (!isCodPaymentMethod(clientOrder.paymentMethod)) return clientOrder;
  const state = await getCodDeliveryState(clientOrder.id);
  if (!state.ok) return clientOrder;
  return { ...clientOrder, codDelivery: state.cod };
}
