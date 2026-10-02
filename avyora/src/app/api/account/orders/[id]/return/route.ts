import { z } from "zod";
import { customerReturnBlockedReason } from "@/lib/order-return";
import { requireAuth } from "@/server/auth/rbac";
import { ensureDb, prisma } from "@/server/db";
import {
  handleApiError,
  HttpParseError,
  jsonError,
  jsonOk,
  parseJson,
} from "@/server/http";
import {
  customerOwnsOrder,
  mapPrismaOrderToClient,
  orderDetailInclude,
} from "@/server/orders/map-order";
import { mirrorClientOrderToCommerce } from "@/server/orders/mirror-commerce";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const returnSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

/** Customer self-service return request — ownership enforced; Delivered only. */
export async function POST(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const { id } = await context.params;
    const session = await requireAuth(request);
    if (!session) return jsonError("Authentication required", 401);
    if (session.isAdmin) {
      return jsonError("Return requests must be submitted by the customer account.", 403);
    }

    const customer = await prisma.customer.findUnique({
      where: { userId: session.userId },
    });
    if (!customer) return jsonError("Customer profile not found", 404);

    const body = await parseJson(request, returnSchema);

    const existing = await prisma.order.findFirst({
      where: { OR: [{ id }, { orderNumber: id }] },
      include: orderDetailInclude,
    });

    if (!existing || !customerOwnsOrder(existing, customer.id, session.email)) {
      return jsonError("Not found", 404);
    }

    const client = mapPrismaOrderToClient(existing);
    if (existing.status !== "DELIVERED") {
      return jsonError(customerReturnBlockedReason(client), 409);
    }

    const reason = body.reason.trim().slice(0, 500);

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.order.update({
        where: { id: existing.id },
        data: {
          status: "RETURN_REQUESTED",
          returnReason: reason,
        },
        include: orderDetailInclude,
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: existing.id,
          status: "RETURN_REQUESTED",
          note: reason,
          actorEmail: session.email,
        },
      });

      await tx.return.create({
        data: {
          orderId: existing.id,
          reason,
          status: "requested",
        },
      });

      return next;
    });

    const mapped = mapPrismaOrderToClient(updated);
    try {
      await mirrorClientOrderToCommerce(mapped);
    } catch {
      /* mirror best-effort */
    }

    return jsonOk(mapped);
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "account/orders/[id]/return POST");
  }
}
