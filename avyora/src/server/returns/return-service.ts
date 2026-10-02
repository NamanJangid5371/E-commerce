import type { OrderStatus, Prisma, ReturnRequestStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { isCodPaymentMethod } from "@/lib/payment-method";
import { createRazorpayRefund } from "@/server/payments/razorpay-refund";
import {
  ACTIVE_RETURN_STATUSES,
  canTransitionReturnStatus,
  isWithinReturnWindow,
  labelReturnStatus,
  refundPreconditionsMet,
  returnWindowDeadline,
  type ReturnActorRole,
} from "@/server/returns/status-machine";

export const returnDetailInclude = {
  orderItem: true,
  order: {
    include: {
      customer: { include: { user: { select: { email: true, name: true } } } },
      payments: { orderBy: { createdAt: "desc" as const }, take: 1 },
    },
  },
  customer: { include: { user: { select: { email: true, name: true } } } },
  events: { orderBy: { createdAt: "asc" as const } },
  refund: true,
} satisfies Prisma.ReturnRequestInclude;

export type ReturnDetail = Prisma.ReturnRequestGetPayload<{ include: typeof returnDetailInclude }>;

function decimalToNumber(value: { toNumber?: () => number } | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}

export function generateReturnNumber() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `RMA-${stamp}-${rand}`;
}

export function serializeReturn(row: ReturnDetail) {
  const lineTotal = decimalToNumber(row.orderItem.lineTotal);
  const unitPrice = decimalToNumber(row.orderItem.unitPrice);
  const qty = Math.min(row.quantity, row.orderItem.quantity);
  const refundAmount = row.refund
    ? decimalToNumber(row.refund.amount)
    : Math.round((lineTotal / Math.max(1, row.orderItem.quantity)) * qty);

  return {
    id: row.id,
    returnNumber: row.returnNumber,
    orderId: row.order.orderNumber,
    orderDbId: row.orderId,
    orderItemId: row.orderItemId,
    customerId: row.customerId,
    customerEmail:
      row.customer?.user?.email ??
      row.order.customer?.user?.email ??
      row.order.guestEmail ??
      null,
    customerName: row.customer?.user?.name ?? row.order.customer?.user?.name ?? null,
    quantity: row.quantity,
    reason: row.reason,
    description: row.description,
    imageUrls: row.imageUrls ?? [],
    status: row.status,
    statusLabel: labelReturnStatus(row.status),
    requestedAt: row.requestedAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    pickupScheduledAt: row.pickupScheduledAt?.toISOString() ?? null,
    pickedUpAt: row.pickedUpAt?.toISOString() ?? null,
    inTransitAt: row.inTransitAt?.toISOString() ?? null,
    warehouseReceivedAt: row.warehouseReceivedAt?.toISOString() ?? null,
    inspectionAt: row.inspectionAt?.toISOString() ?? null,
    refundEligibleAt: row.refundEligibleAt?.toISOString() ?? null,
    refundInitiatedAt: row.refundInitiatedAt?.toISOString() ?? null,
    refundCompletedAt: row.refundCompletedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    productVerified: row.productVerified,
    productVerifiedAt: row.productVerifiedAt?.toISOString() ?? null,
    productVerifiedBy: row.productVerifiedBy,
    inspectionNotes: row.inspectionNotes,
    inspectionBy: row.inspectionBy,
    rejectReason: row.rejectReason,
    pickupNote: row.pickupNote,
    trackingNumber: row.trackingNumber,
    courier: row.courier,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    item: {
      id: row.orderItem.id,
      productId: row.orderItem.productId,
      name: row.orderItem.name,
      sku: row.orderItem.sku,
      image: row.orderItem.image,
      quantity: row.orderItem.quantity,
      unitPrice,
      lineTotal,
      deliveredAt: row.orderItem.deliveredAt?.toISOString() ?? row.order.deliveredAt?.toISOString() ?? null,
    },
    order: {
      id: row.order.orderNumber,
      status: row.order.status,
      total: decimalToNumber(row.order.total),
      paymentMethod: row.order.paymentMethod,
      deliveredAt: row.order.deliveredAt?.toISOString() ?? null,
      createdAt: row.order.createdAt.toISOString(),
    },
    refund: row.refund
      ? {
          id: row.refund.id,
          amount: decimalToNumber(row.refund.amount),
          method: row.refund.method,
          status: row.refund.status,
          providerRefundId: row.refund.providerRefundId,
          reason: row.refund.reason,
          initiatedAt: row.refund.initiatedAt?.toISOString() ?? null,
          completedAt: row.refund.completedAt?.toISOString() ?? null,
        }
      : null,
    estimatedRefundAmount: refundAmount,
    events: row.events.map((e) => ({
      id: e.id,
      status: e.status,
      statusLabel: labelReturnStatus(e.status),
      note: e.note,
      actorEmail: e.actorEmail,
      actorRole: e.actorRole,
      at: e.createdAt.toISOString(),
    })),
  };
}

export type SerializedReturn = ReturnType<typeof serializeReturn>;

async function loadReturn(id: string) {
  return prisma.returnRequest.findFirst({
    where: { OR: [{ id }, { returnNumber: id }] },
    include: returnDetailInclude,
  });
}

export async function listReturns(filters: {
  status?: ReturnRequestStatus | ReturnRequestStatus[];
  q?: string;
  /** Filter by shop order number (e.g. AVY-…) or Prisma order id. */
  orderId?: string;
  customerId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 50));
  const where: Prisma.ReturnRequestWhereInput = {};

  if (filters.status) {
    where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
  }
  if (filters.orderId?.trim()) {
    const oid = filters.orderId.trim();
    where.order = { OR: [{ orderNumber: oid }, { id: oid }] };
  }
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.from || filters.to) {
    where.requestedAt = {};
    if (filters.from) where.requestedAt.gte = filters.from;
    if (filters.to) where.requestedAt.lte = filters.to;
  }
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { returnNumber: { contains: q, mode: "insensitive" } },
      { order: { orderNumber: { contains: q, mode: "insensitive" } } },
      { orderItem: { name: { contains: q, mode: "insensitive" } } },
      { orderItem: { sku: { contains: q, mode: "insensitive" } } },
      { customer: { user: { email: { contains: q, mode: "insensitive" } } } },
      { order: { guestEmail: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.returnRequest.count({ where }),
    prisma.returnRequest.findMany({
      where,
      include: returnDetailInclude,
      orderBy: { requestedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    returns: rows.map(serializeReturn),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getReturnById(id: string) {
  const row = await loadReturn(id);
  return row ? serializeReturn(row) : null;
}

export async function createCustomerReturn(input: {
  customerId: string;
  customerEmail: string;
  orderIdOrNumber: string;
  orderItemId: string;
  reason: string;
  description?: string;
  quantity?: number;
  imageUrls?: string[];
}) {
  const order = await prisma.order.findFirst({
    where: {
      OR: [{ id: input.orderIdOrNumber }, { orderNumber: input.orderIdOrNumber }],
    },
    include: {
      items: true,
      customer: { include: { user: { select: { email: true } } } },
      statusHistory: {
        where: { status: "DELIVERED" },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  if (!order) return { ok: false as const, message: "Order not found.", status: 404 };

  const owns =
    order.customerId === input.customerId ||
    (order.guestEmail ?? "").toLowerCase() === input.customerEmail.toLowerCase() ||
    (order.customer?.user?.email ?? "").toLowerCase() === input.customerEmail.toLowerCase();
  if (!owns) return { ok: false as const, message: "Order not found.", status: 404 };

  const blockedStatuses = new Set(["CANCELLED", "PENDING_PAYMENT", "REFUNDED"]);
  if (blockedStatuses.has(order.status)) {
    return {
      ok: false as const,
      message: "This order cannot accept return requests.",
      status: 409,
    };
  }

  const item = order.items.find((i) => i.id === input.orderItemId);
  if (!item) return { ok: false as const, message: "Order item not found on this order.", status: 404 };

  const deliveredAt =
    item.deliveredAt ??
    order.deliveredAt ??
    order.statusHistory[0]?.createdAt ??
    null;

  if (!deliveredAt) {
    return {
      ok: false as const,
      message: "Returns can only be requested after the product has been delivered.",
      status: 409,
    };
  }

  if (!isWithinReturnWindow(deliveredAt)) {
    const deadline = returnWindowDeadline(deliveredAt);
    return {
      ok: false as const,
      message: `Return window closed on ${deadline.toLocaleDateString("en-IN")} (15 days from delivery).`,
      status: 409,
    };
  }

  const active = await prisma.returnRequest.findFirst({
    where: {
      orderItemId: item.id,
      status: { in: ACTIVE_RETURN_STATUSES },
    },
  });
  if (active) {
    return {
      ok: false as const,
      message: "An active return already exists for this product.",
      status: 409,
    };
  }

  const qty = Math.min(
    Math.max(1, input.quantity ?? item.quantity),
    item.quantity,
  );

  const created = await prisma.$transaction(async (tx) => {
    // Ensure delivery stamps exist for future checks.
    if (!order.deliveredAt || !item.deliveredAt) {
      await tx.order.update({
        where: { id: order.id },
        data: { deliveredAt: deliveredAt },
      });
      await tx.orderItem.update({
        where: { id: item.id },
        data: { deliveredAt },
      });
    }

    const row = await tx.returnRequest.create({
      data: {
        returnNumber: generateReturnNumber(),
        orderId: order.id,
        orderItemId: item.id,
        customerId: input.customerId,
        quantity: qty,
        reason: input.reason.trim().slice(0, 500),
        description: input.description?.trim().slice(0, 2000) || null,
        imageUrls: (input.imageUrls ?? []).slice(0, 6),
        status: "RETURN_REQUESTED",
        events: {
          create: {
            status: "RETURN_REQUESTED",
            note: input.reason.trim().slice(0, 500),
            actorEmail: input.customerEmail,
            actorRole: "customer",
          },
        },
      },
      include: returnDetailInclude,
    });

    // Keep legacy order marker for ops visibility.
    if (order.status === "DELIVERED" || order.status === "RETURN_REQUESTED") {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "RETURN_REQUESTED",
          returnReason: input.reason.trim().slice(0, 500),
        },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: "RETURN_REQUESTED",
          note: `Return ${row.returnNumber}: ${input.reason.trim().slice(0, 200)}`,
          actorEmail: input.customerEmail,
        },
      });
      await tx.return.create({
        data: {
          orderId: order.id,
          reason: input.reason.trim().slice(0, 500),
          status: "requested",
        },
      });
    }

    return row;
  });

  return { ok: true as const, data: serializeReturn(created) };
}

/** Map return RMA stage → order-level status shown on admin/customer order panels. */
function orderStatusForReturnStage(status: ReturnRequestStatus): OrderStatus | null {
  switch (status) {
    case "RETURN_REQUESTED":
    case "RETURN_APPROVED":
      return "RETURN_REQUESTED";
    case "PICKUP_SCHEDULED":
    case "PICKED_UP":
    case "IN_TRANSIT":
      return "RETURN_PICKUP";
    case "RECEIVED_AT_WAREHOUSE":
    case "INSPECTION_PENDING":
    case "INSPECTION_APPROVED":
    case "REFUND_ELIGIBLE":
    case "REFUND_INITIATED":
      return "RETURNED";
    case "REFUND_COMPLETED":
      return "REFUNDED";
    default:
      return null;
  }
}

async function mirrorReturnStageToOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  step: ReturnRequestStatus,
  actorEmail: string,
) {
  const mirror = orderStatusForReturnStage(step);
  if (!mirror) return;
  await tx.order.update({
    where: { id: orderId },
    data: { status: mirror },
  });
  await tx.orderStatusHistory.create({
    data: {
      orderId,
      status: mirror,
      note: labelReturnStatus(step),
      actorEmail,
    },
  });
}

function stampForStatus(
  status: ReturnRequestStatus,
  now: Date,
): Partial<Prisma.ReturnRequestUpdateInput> {
  switch (status) {
    case "RETURN_APPROVED":
      return { approvedAt: now };
    case "RETURN_REJECTED":
      return { rejectedAt: now };
    case "PICKUP_SCHEDULED":
      return { pickupScheduledAt: now };
    case "PICKED_UP":
      return { pickedUpAt: now };
    case "IN_TRANSIT":
      return { inTransitAt: now };
    case "RECEIVED_AT_WAREHOUSE":
      return { warehouseReceivedAt: now };
    case "INSPECTION_PENDING":
      return {};
    case "INSPECTION_APPROVED":
      return { inspectionAt: now };
    case "REFUND_ELIGIBLE":
      return { refundEligibleAt: now };
    case "REFUND_INITIATED":
      return { refundInitiatedAt: now };
    case "REFUND_COMPLETED":
      return { refundCompletedAt: now };
    case "RETURN_CANCELLED":
      return { cancelledAt: now };
    case "INSPECTION_REJECTED":
      return { inspectionAt: now, rejectedAt: now };
    default:
      return {};
  }
}

export async function transitionReturn(input: {
  id: string;
  to: ReturnRequestStatus;
  role: ReturnActorRole;
  actorEmail: string;
  note?: string;
  /** Required when moving to RECEIVED_AT_WAREHOUSE */
  confirmProductMatch?: boolean;
  expectedOrderItemId?: string;
  trackingNumber?: string;
  courier?: string;
  pickupNote?: string;
  inspectionNotes?: string;
}) {
  const existing = await loadReturn(input.id);
  if (!existing) return { ok: false as const, message: "Return not found.", status: 404 };

  const check = canTransitionReturnStatus(existing.status, input.to, input.role);
  if (!check.ok) return { ok: false as const, message: check.message, status: 400 };

  // Warehouse receipt requires explicit product verification.
  if (input.to === "RECEIVED_AT_WAREHOUSE") {
    if (!input.confirmProductMatch) {
      return {
        ok: false as const,
        message: "Confirm that the received product matches the order item.",
        status: 400,
      };
    }
    if (input.expectedOrderItemId && input.expectedOrderItemId !== existing.orderItemId) {
      return {
        ok: false as const,
        message: "Received product does not match the return order item.",
        status: 400,
      };
    }
  }

  const now = new Date();
  const chain: ReturnRequestStatus[] = [input.to];

  // Auto-advance: warehouse receipt → inspection pending (logistics warehouse step)
  if (input.to === "RECEIVED_AT_WAREHOUSE") {
    chain.push("INSPECTION_PENDING");
  }
  // Refund eligible is an explicit admin decision — do not auto-advance from inspection.

  for (const step of chain.slice(1)) {
    const mid = canTransitionReturnStatus(
      chain[chain.indexOf(step) - 1] ?? input.to,
      step,
      step === "REFUND_ELIGIBLE" || step === "INSPECTION_PENDING" ? "system" : input.role,
    );
    // Validate chain from previous status in chain
    void mid;
  }

  // Validate auto steps from the actual previous status
  let cursor = existing.status;
  for (const step of chain) {
    const roleForStep: ReturnActorRole =
      step === "INSPECTION_PENDING" || step === "REFUND_ELIGIBLE" ? "system" : input.role;
    const ok = canTransitionReturnStatus(cursor, step, roleForStep);
    if (!ok.ok) return { ok: false as const, message: ok.message, status: 400 };
    cursor = step;
  }

  const updated = await prisma.$transaction(async (tx) => {
    let current = existing.status;
    let row = existing;

    for (const step of chain) {
      const data: Prisma.ReturnRequestUpdateInput = {
        status: step,
        ...stampForStatus(step, now),
      };

      if (step === "RECEIVED_AT_WAREHOUSE") {
        data.productVerified = true;
        data.productVerifiedAt = now;
        data.productVerifiedBy = input.actorEmail;
      }
      if (input.trackingNumber !== undefined) data.trackingNumber = input.trackingNumber.trim() || null;
      if (input.courier !== undefined) data.courier = input.courier.trim() || null;
      if (input.pickupNote !== undefined) data.pickupNote = input.pickupNote.trim() || null;
      if (input.inspectionNotes !== undefined) data.inspectionNotes = input.inspectionNotes.trim() || null;
      if (step === "INSPECTION_APPROVED" || step === "INSPECTION_REJECTED") {
        data.inspectionBy = input.actorEmail;
      }
      if (step === "RETURN_REJECTED" || step === "INSPECTION_REJECTED") {
        data.rejectReason = input.note?.trim() || "Rejected";
      }

      row = await tx.returnRequest.update({
        where: { id: existing.id },
        data: {
          ...data,
          events: {
            create: {
              status: step,
              note: input.note?.trim() || null,
              actorEmail: input.actorEmail,
              actorRole:
                step === "INSPECTION_PENDING" || step === "REFUND_ELIGIBLE" ? "system" : input.role,
            },
          },
        },
        include: returnDetailInclude,
      });
      current = step;
      await mirrorReturnStageToOrder(tx, existing.orderId, step, input.actorEmail);
    }

    if (current === "RETURN_REJECTED" || current === "RETURN_CANCELLED") {
      const otherActive = await tx.returnRequest.count({
        where: {
          orderId: existing.orderId,
          id: { not: existing.id },
          status: { in: ACTIVE_RETURN_STATUSES },
        },
      });
      if (!otherActive) {
        await tx.order.update({
          where: { id: existing.orderId },
          data: { status: "DELIVERED" },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId: existing.orderId,
            status: "DELIVERED",
            note: labelReturnStatus(current),
            actorEmail: input.actorEmail,
          },
        });
      }
    }

    return row;
  });

  // Keep commerce.json mirror in sync for storefront/admin Zustand panels.
  try {
    const { loadOrderByNumber } = await import("@/server/orders/load-orders");
    const { mirrorClientOrderToCommerce } = await import("@/server/orders/mirror-commerce");
    const clientOrder = await loadOrderByNumber(updated.order.orderNumber);
    if (clientOrder) await mirrorClientOrderToCommerce(clientOrder);
  } catch {
    // Non-fatal: Postgres remains source of truth.
  }

  return { ok: true as const, data: serializeReturn(updated) };
}

export async function initiateRefund(input: {
  id: string;
  actorEmail: string;
  amount?: number;
  reason?: string;
}) {
  const existing = await loadReturn(input.id);
  if (!existing) return { ok: false as const, message: "Return not found.", status: 404 };

  const pre = refundPreconditionsMet({
    status: existing.status,
    warehouseReceivedAt: existing.warehouseReceivedAt,
    productVerified: existing.productVerified,
    inspectionAt: existing.inspectionAt,
  });
  if (!pre.ok) return { ok: false as const, message: pre.message, status: 409 };

  if (existing.refund && (existing.refund.status === "completed" || existing.refund.status === "initiated")) {
    return { ok: false as const, message: "A refund already exists for this return.", status: 409 };
  }

  const lineTotal = decimalToNumber(existing.orderItem.lineTotal);
  const perUnit = lineTotal / Math.max(1, existing.orderItem.quantity);
  const defaultAmount = Math.round(perUnit * existing.quantity * 100) / 100;
  const amount =
    typeof input.amount === "number" && input.amount > 0 ? input.amount : defaultAmount;

  const payment = existing.order.payments[0];
  const method = isCodPaymentMethod(existing.order.paymentMethod ?? payment?.method)
    ? "cod"
    : payment?.provider === "razorpay"
      ? "razorpay"
      : "manual";

  const now = new Date();

  // Move to REFUND_INITIATED first (race-safe via status check).
  let initiated: { row: ReturnDetail; refund: { id: string } };
  try {
    initiated = await prisma.$transaction(async (tx) => {
      const locked = await tx.returnRequest.findUnique({ where: { id: existing.id } });
      if (!locked || locked.status !== "REFUND_ELIGIBLE") {
        throw new Error("Return is no longer refund-eligible.");
      }
      if (await tx.refund.findFirst({ where: { returnRequestId: existing.id } })) {
        throw new Error("A refund already exists for this return.");
      }

      const refund = await tx.refund.create({
        data: {
          orderId: existing.orderId,
          returnRequestId: existing.id,
          amount,
          reason: input.reason?.trim() || existing.reason,
          method,
          status: "initiated",
          initiatedAt: now,
        },
      });

      const row = await tx.returnRequest.update({
        where: { id: existing.id },
        data: {
          status: "REFUND_INITIATED",
          refundInitiatedAt: now,
          events: {
            create: {
              status: "REFUND_INITIATED",
              note: `Refund ${amount} via ${method}`,
              actorEmail: input.actorEmail,
              actorRole: "admin",
            },
          },
        },
        include: returnDetailInclude,
      });

      return { row, refund };
    });
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "Could not initiate refund.",
      status: 409,
    };
  }

  let providerRefundId: string | null = null;
  let gatewayFailed = false;

  if (method === "razorpay" && payment?.providerPaymentId) {
    try {
      const gw = await createRazorpayRefund({
        paymentId: payment.providerPaymentId,
        amountInr: amount,
        notes: { returnId: existing.id, returnNumber: existing.returnNumber },
      });
      providerRefundId = gw.id;
    } catch {
      // Gateway optional — complete as manual ledger if Razorpay unavailable.
      gatewayFailed = true;
    }
  }

  const completed = await prisma.$transaction(async (tx) => {
    await tx.refund.update({
      where: { id: initiated.refund.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        providerRefundId: providerRefundId,
        method: gatewayFailed && method === "razorpay" ? "manual" : method,
      },
    });

    const row = await tx.returnRequest.update({
      where: { id: existing.id },
      data: {
        status: "REFUND_COMPLETED",
        refundCompletedAt: new Date(),
        events: {
          create: {
            status: "REFUND_COMPLETED",
            note: providerRefundId
              ? `Provider refund ${providerRefundId}`
              : "Refund recorded",
            actorEmail: input.actorEmail,
            actorRole: "admin",
          },
        },
      },
      include: returnDetailInclude,
    });

    const prevRefunded = decimalToNumber(existing.order.refundedAmount);
    const orderTotal = decimalToNumber(existing.order.total);
    const nextRefunded = prevRefunded + amount;
    const fullyRefunded = nextRefunded >= orderTotal - 0.01;
    await tx.order.update({
      where: { id: existing.orderId },
      data: {
        refundedAmount: nextRefunded,
        // Keep order as REFUNDED only when the full order value is refunded.
        ...(fullyRefunded ? { status: "REFUNDED" as const } : {}),
      },
    });

    if (payment && payment.status !== "REFUNDED") {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" },
      });
    }

    // Restock this line once.
    const restockTag = `return_request_restock:${existing.id}`;
    const prior = await tx.stockMovement.findFirst({ where: { reason: restockTag } });
    if (!prior) {
      await tx.productVariant.update({
        where: { id: existing.orderItem.variantId },
        data: { stock: { increment: existing.quantity } },
      });
      const inventory = await tx.inventory.findFirst({
        where: { variantId: existing.orderItem.variantId },
      });
      if (inventory) {
        await tx.inventory.update({
          where: { id: inventory.id },
          data: { quantity: { increment: existing.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            inventoryId: inventory.id,
            delta: existing.quantity,
            reason: restockTag,
            actorEmail: input.actorEmail,
          },
        });
      }
    }

    return row;
  });

  return { ok: true as const, data: serializeReturn(completed) };
}

/** Stamp deliveredAt when logistics/admin marks an order delivered. */
export async function stampOrderDelivered(orderId: string, at = new Date()) {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) return;
    if (!order.deliveredAt) {
      await tx.order.update({
        where: { id: orderId },
        data: { deliveredAt: at },
      });
    }
    await tx.orderItem.updateMany({
      where: { orderId, deliveredAt: null },
      data: { deliveredAt: order.deliveredAt ?? at },
    });
  });
}
