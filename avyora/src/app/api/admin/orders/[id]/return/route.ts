import { z } from "zod";
import { hasPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { ensureDb, prisma } from "@/server/db";
import {
  handleApiError,
  HttpParseError,
  jsonError,
  jsonOk,
  parseJson,
} from "@/server/http";
import { mapPrismaOrderToClient, orderDetailInclude } from "@/server/orders/map-order";
import { mirrorClientOrderToCommerce } from "@/server/orders/mirror-commerce";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const rejectSchema = z.object({
  action: z.literal("reject"),
  reason: z.string().trim().max(500).optional(),
});

/** Admin rejects a customer return request (restores Delivered). */
export async function POST(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const session = await getSessionFromRequest(request);
    if (!session) return jsonError("Staff authentication required.", 401);
    if (
      !hasPermission(session.permissions, PERMISSIONS.ORDER_UPDATE) &&
      !hasPermission(session.permissions, PERMISSIONS.ORDER_REFUND)
    ) {
      return jsonError("Insufficient permissions.", 403);
    }

    const { id } = await context.params;
    const body = await parseJson(request, rejectSchema);

    const existing = await prisma.order.findFirst({
      where: { OR: [{ id }, { orderNumber: id }, { legacyId: id }] },
      include: orderDetailInclude,
    });
    if (!existing) return jsonError("Order not found", 404);

    if (existing.status !== "RETURN_REQUESTED" && existing.status !== "RETURN_PICKUP") {
      return jsonError("Only open return requests can be rejected.", 409);
    }

    const note =
      body.reason?.trim() ||
      "Return request rejected by admin";

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.order.update({
        where: { id: existing.id },
        data: {
          status: "DELIVERED",
          returnReason: note,
        },
        include: orderDetailInclude,
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: existing.id,
          status: "DELIVERED",
          note,
          actorEmail: session.email,
        },
      });

      await tx.return.updateMany({
        where: { orderId: existing.id, status: { not: "completed" } },
        data: { status: "rejected" },
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
    return handleApiError(error, "admin/orders/[id]/return POST");
  }
}
