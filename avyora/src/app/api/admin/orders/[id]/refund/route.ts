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
import { initiateRefund } from "@/server/returns/return-service";
import { refundPreconditionsMet } from "@/server/returns/status-machine";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const refundSchema = z.object({
  /** Required when the order has multiple REFUND_ELIGIBLE return requests. */
  returnRequestId: z.string().trim().min(1).optional(),
  amount: z.number().positive().optional(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Compatibility shim: order-level refunds must go through an RMA ReturnRequest that
 * already passed warehouse receipt + product verification + inspection (REFUND_ELIGIBLE).
 * Prefer POST /api/admin/returns/[id] { action: "refund" }.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const session = await getSessionFromRequest(request);
    if (!session) return jsonError("Staff authentication required.", 401);
    if (
      !hasPermission(session.permissions, PERMISSIONS.ORDER_REFUND) &&
      !hasPermission(session.permissions, PERMISSIONS.ORDER_UPDATE)
    ) {
      return jsonError("Insufficient permissions to issue refunds.", 403);
    }

    const { id } = await context.params;
    const body = await parseJson(request, refundSchema);

    const existing = await prisma.order.findFirst({
      where: { OR: [{ id }, { orderNumber: id }, { legacyId: id }] },
      select: { id: true, orderNumber: true },
    });
    if (!existing) return jsonError("Order not found", 404);

    const candidates = await prisma.returnRequest.findMany({
      where: {
        orderId: existing.id,
        status: "REFUND_ELIGIBLE",
      },
      orderBy: { requestedAt: "asc" },
    });

    let targetId = body.returnRequestId?.trim() || "";

    if (targetId) {
      const targeted = await prisma.returnRequest.findFirst({
        where: {
          orderId: existing.id,
          OR: [{ id: targetId }, { returnNumber: targetId }],
        },
      });
      if (!targeted) {
        return jsonError("Return request not found on this order.", 404);
      }
      const pre = refundPreconditionsMet({
        status: targeted.status,
        warehouseReceivedAt: targeted.warehouseReceivedAt,
        productVerified: targeted.productVerified,
        inspectionAt: targeted.inspectionAt,
      });
      if (!pre.ok) {
        return jsonError(
          `${pre.message} Use Admin → Returns after logistics warehouse/inspection.`,
          409,
        );
      }
      targetId = targeted.id;
    } else if (candidates.length === 1) {
      const only = candidates[0];
      const pre = refundPreconditionsMet({
        status: only.status,
        warehouseReceivedAt: only.warehouseReceivedAt,
        productVerified: only.productVerified,
        inspectionAt: only.inspectionAt,
      });
      if (!pre.ok) {
        return jsonError(
          `${pre.message} Use Admin → Returns after logistics warehouse/inspection.`,
          409,
        );
      }
      targetId = only.id;
    } else if (candidates.length === 0) {
      return jsonError(
        "Refunds require a return request that is REFUND_ELIGIBLE after warehouse receipt and inspection. Open Admin → Returns for this order.",
        409,
      );
    } else {
      return jsonError(
        "Multiple refund-eligible returns on this order. Pass returnRequestId, or refund from Admin → Returns.",
        409,
        { returnRequestIds: candidates.map((r) => r.id) },
      );
    }

    const result = await initiateRefund({
      id: targetId,
      actorEmail: session.email,
      amount: body.amount,
      reason: body.reason,
    });
    if (!result.ok) return jsonError(result.message, result.status);

    const refreshed = await prisma.order.findUnique({
      where: { id: existing.id },
      include: orderDetailInclude,
    });
    if (!refreshed) return jsonOk({ returnRequest: result.data });

    const mapped = mapPrismaOrderToClient(refreshed);
    try {
      await mirrorClientOrderToCommerce(mapped);
    } catch {
      /* mirror best-effort */
    }

    return jsonOk({
      ...mapped,
      returnRequest: result.data,
    });
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "admin/orders/[id]/refund POST");
  }
}
