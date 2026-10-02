import { z } from "zod";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { ensureDb } from "@/server/db";
import {
  handleApiError,
  HttpParseError,
  jsonError,
  jsonOk,
  parseJson,
} from "@/server/http";
import { canManageLogistics, canViewLogistics } from "@/server/logistics/auth";
import { getCodDeliveryState } from "@/server/cod/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const actionSchema = z.object({
  action: z.literal("status"),
});

export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const session = await getSessionFromRequest(request);
    if (!canViewLogistics(session)) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }
    const { id } = await context.params;
    const state = await getCodDeliveryState(id);
    if (!state.ok) return jsonError(state.message, state.status);
    return jsonOk({ cod: state.cod });
  } catch (error) {
    return handleApiError(error, "logistics/orders/[id]/cod GET");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const session = await getSessionFromRequest(request);
    if (!canManageLogistics(session) || !session) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }

    const { id } = await context.params;
    const body = await parseJson(request, actionSchema);

    // Read-only status remains for warehouse; doorstep actions are partner-only.
    if (body.action === "status") {
      const state = await getCodDeliveryState(id);
      if (!state.ok) return jsonError(state.message, state.status);
      return jsonOk({ cod: state.cod });
    }

    return jsonError(
      "COD OTP and doorstep collection are managed by the delivery partner via Local Dispatch (/api/dispatch/orders/:id/cod).",
      403,
    );
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "logistics/orders/[id]/cod POST");
  }
}
