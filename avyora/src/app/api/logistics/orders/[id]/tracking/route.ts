import { getSessionFromRequest } from "@/server/auth/rbac";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import { canManageLogistics } from "@/server/logistics/auth";
import {
  addLogisticsTrackingEvent,
  findOpsOrder,
  persistOrder,
} from "@/server/logistics/mutations";
import { z } from "zod";

export const dynamic = "force-dynamic";

const trackingSchema = z.object({
  title: z.string().trim().min(1),
  location: z.string().optional(),
  description: z.string().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await getSessionFromRequest(request);
    if (!canManageLogistics(session)) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }

    const body = await parseJson(request, trackingSchema);
    const { id } = await context.params;
    const { order } = await findOpsOrder(id);
    if (!order) return jsonError("Order not found", 404);

    const { order: next } = addLogisticsTrackingEvent(order, {
      title: body.title,
      location: body.location,
      description: body.description,
      updatedBy: session.email,
    });

    return jsonOk(await persistOrder(id, next, session.email));
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "logistics/orders/[id]/tracking POST");
  }
}
