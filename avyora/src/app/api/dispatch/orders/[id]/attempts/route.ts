import { z } from "zod";
import { DELIVERY_ATTEMPT_REASONS } from "@/lib/logistics-orders";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { attachCodToClientOrder } from "@/server/cod/service";
import {
  canManageDispatchJobs,
  orderAssignedToPartner,
  resolveDispatchPartnerScope,
} from "@/server/dispatch/auth";
import { ensureDb } from "@/server/db";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import {
  findOpsOrder,
  persistOrder,
  recordLogisticsAttempt,
} from "@/server/logistics/mutations";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const attemptSchema = z.object({
  status: z.enum(["attempted", "failed", "rescheduled", "delivered"]),
  reason: z.enum(DELIVERY_ATTEMPT_REASONS as [string, ...string[]]).optional(),
  note: z.string().optional(),
  location: z.string().optional(),
  setFailedDelivery: z.boolean().optional(),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const session = await getSessionFromRequest(request);
    if (!canManageDispatchJobs(session) || !session) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }
    const scope = resolveDispatchPartnerScope(session);
    const { id } = await context.params;
    const { order } = await findOpsOrder(id);
    if (!order) return jsonError("Order not found", 404);
    if (!orderAssignedToPartner(order, scope)) {
      return jsonError("This order is not assigned to your delivery partner.", 403);
    }

    const body = await parseJson(request, attemptSchema);
    const result = recordLogisticsAttempt(order, {
      status: body.status,
      reason: body.reason as (typeof DELIVERY_ATTEMPT_REASONS)[number] | undefined,
      note: body.note,
      location: body.location,
      setFailedDelivery: body.setFailedDelivery,
      updatedBy: session.email,
    });
    if (!result.ok) return jsonError(result.message, 400);

    const saved = await persistOrder(id, result.order, session.email);
    return jsonOk({ order: await attachCodToClientOrder(saved) });
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "dispatch/orders/[id]/attempts POST");
  }
}
