import { getSessionFromRequest } from "@/server/auth/rbac";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import { canManageLogistics } from "@/server/logistics/auth";
import {
  findOpsOrder,
  persistOrder,
  recordLogisticsAttempt,
} from "@/server/logistics/mutations";
import { DELIVERY_ATTEMPT_REASONS } from "@/lib/logistics-orders";
import { z } from "zod";

export const dynamic = "force-dynamic";

const attemptSchema = z.object({
  status: z.enum(["attempted", "failed", "rescheduled", "delivered"]),
  reason: z.enum(DELIVERY_ATTEMPT_REASONS as [string, ...string[]]).optional(),
  note: z.string().optional(),
  location: z.string().optional(),
  setFailedDelivery: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await getSessionFromRequest(request);
    if (!canManageLogistics(session)) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }

    const body = await parseJson(request, attemptSchema);
    const { id } = await context.params;
    const { order } = await findOpsOrder(id);
    if (!order) return jsonError("Order not found", 404);

    const result = recordLogisticsAttempt(order, {
      status: body.status,
      reason: body.reason as (typeof DELIVERY_ATTEMPT_REASONS)[number] | undefined,
      note: body.note,
      location: body.location,
      setFailedDelivery: body.setFailedDelivery,
      updatedBy: session.email,
    });

    if (!result.ok) return jsonError(result.message, 400);

    return jsonOk(await persistOrder(id, result.order, session.email));
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "logistics/orders/[id]/attempts POST");
  }
}
