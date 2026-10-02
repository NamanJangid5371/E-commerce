import { z } from "zod";
import { requireAuth } from "@/server/auth/rbac";
import { ensureDb, prisma } from "@/server/db";
import {
  handleApiError,
  HttpParseError,
  jsonError,
  jsonOk,
  parseJson,
} from "@/server/http";
import { customerCancelBlockedReason } from "@/lib/order-cancel";
import {
  inventoryHoldConfirmed,
  releaseInventoryHoldForOrder,
  reserveReasonTag,
  restockConfirmedInventoryForOrder,
  stockLinesFromOrderItems,
} from "@/server/inventory/reservation";
import {
  canCustomerCancelPrismaStatus,
  customerOwnsOrder,
  mapPrismaOrderToClient,
  orderDetailInclude,
} from "@/server/orders/map-order";
import { mirrorClientOrderToCommerce } from "@/server/orders/mirror-commerce";
import { notifyAdminPaidOrderCancelRefund } from "@/server/orders/notify-paid-cancel-refund";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const cancelSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

async function loadOwnedOrder(id: string, customerId: string, email: string) {
  const order = await prisma.order.findFirst({
    where: {
      OR: [{ id }, { orderNumber: id }],
    },
    include: orderDetailInclude,
  });

  if (!order || !customerOwnsOrder(order, customerId, email)) {
    return null;
  }

  return order;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const { id } = await context.params;
    const session = await requireAuth(request);
    if (!session) return jsonError("Authentication required", 401);
    if (session.isAdmin) return jsonError("Use staff logistics APIs for admin order access", 403);

    const customer = await prisma.customer.findUnique({
      where: { userId: session.userId },
    });
    if (!customer) return jsonError("Customer profile not found", 404);

    const order = await loadOwnedOrder(id, customer.id, session.email);
    if (!order) return jsonError("Not found", 404);

    return jsonOk(mapPrismaOrderToClient(order));
  } catch (error) {
    return handleApiError(error, "account/orders/[id] GET");
  }
}

/** Customer self-service cancel — ownership enforced; stock restored. */
export async function POST(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const { id } = await context.params;
    const session = await requireAuth(request);
    if (!session) return jsonError("Authentication required", 401);
    if (session.isAdmin) return jsonError("Staff should cancel via logistics tools", 403);

    const customer = await prisma.customer.findUnique({
      where: { userId: session.userId },
    });
    if (!customer) return jsonError("Customer profile not found", 404);

    const body = await parseJson(request, cancelSchema);
    const existing = await loadOwnedOrder(id, customer.id, session.email);
    if (!existing) return jsonError("Not found", 404);

    if (!canCustomerCancelPrismaStatus(existing.status)) {
      return jsonError(
        customerCancelBlockedReason({
          ...mapPrismaOrderToClient(existing),
        }),
        409,
      );
    }

    const reason = (body.reason?.trim() || "Cancelled by customer").slice(0, 200);

    const updated = await prisma.$transaction(async (tx) => {
      const cancelled = await tx.order.update({
        where: { id: existing.id },
        data: {
          status: "CANCELLED",
          cancelReason: reason,
        },
        include: orderDetailInclude,
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: existing.id,
          status: "CANCELLED",
          note: reason,
          actorEmail: session.email,
        },
      });

      const lines = stockLinesFromOrderItems(existing.items);
      const confirmed = await inventoryHoldConfirmed(tx, existing.id);
      const softHeld = await tx.stockMovement.findFirst({
        where: { reason: reserveReasonTag(existing.id) },
        select: { id: true },
      });
      if (softHeld && !confirmed && existing.status === "PENDING_PAYMENT") {
        // Unpaid soft hold — release reserved only.
        await releaseInventoryHoldForOrder(tx, existing.id, lines, {
          actorEmail: session.email,
          reasonTag: `order_release:${existing.id}`,
          alsoSkipIfReasons: [`pending_payment_ttl_restock:${existing.id}`],
        });
      } else {
        // Confirmed sale, COD, or legacy hard-decrement — restore sellable + on-hand.
        await restockConfirmedInventoryForOrder(tx, existing.id, lines, {
          actorEmail: session.email,
          reasonTag: `order_cancel_restock:${existing.id}`,
          alsoSkipIfReasons: [
            `pending_payment_ttl_restock:${existing.id}`,
            `order_release:${existing.id}`,
          ],
        });
      }

      return cancelled;
    });

    // Reload with fresh history after cancel event.
    const fresh = await prisma.order.findUnique({
      where: { id: updated.id },
      include: orderDetailInclude,
    });

    const client = mapPrismaOrderToClient(fresh ?? updated);
    try {
      await mirrorClientOrderToCommerce(client);
    } catch {
      /* mirror best-effort */
    }

    // Paid cancels need an admin refund — notify staff (email + audit + queue).
    void notifyAdminPaidOrderCancelRefund(updated.id).catch(() => undefined);

    return jsonOk(client);
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "account/orders/[id] cancel");
  }
}
