import { z } from "zod";
import { getSessionFromRequest } from "@/server/auth/rbac";
import {
  attachCodToClientOrder,
  createCodDoorstepUpiOrder,
  getCodDeliveryState,
  issueCodDeliveryOtp,
  markCodCashCollected,
  verifyCodDeliveryOtp,
  verifyCodDoorstepUpi,
} from "@/server/cod/service";
import {
  canManageDispatchJobs,
  orderAssignedToPartner,
  resolveDispatchPartnerScope,
} from "@/server/dispatch/auth";
import { ensureDb } from "@/server/db";
import {
  handleApiError,
  HttpParseError,
  jsonError,
  jsonOk,
  parseJson,
} from "@/server/http";
import { findOpsOrder } from "@/server/logistics/mutations";
import { loadOrderByNumber } from "@/server/orders/load-orders";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({ action: z.literal("resend_otp") }),
  z.object({
    action: z.literal("verify_otp"),
    code: z.string().trim().min(4).max(12),
  }),
  z.object({ action: z.literal("collect_cash") }),
  z.object({ action: z.literal("upi_order") }),
  z.object({
    action: z.literal("upi_verify"),
    razorpay_order_id: z.string().min(1),
    razorpay_payment_id: z.string().min(1),
    razorpay_signature: z.string().min(1),
  }),
]);

async function orderResponse(id: string) {
  const order = (await loadOrderByNumber(id)) ?? (await findOpsOrder(id)).order;
  if (!order) return null;
  return attachCodToClientOrder(order);
}

export async function POST(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const session = await getSessionFromRequest(request);
    if (!canManageDispatchJobs(session) || !session) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }
    const scope = resolveDispatchPartnerScope(session);
    const { id } = await context.params;
    const existing = (await loadOrderByNumber(id)) ?? (await findOpsOrder(id)).order;
    if (!existing) return jsonError("Order not found", 404);
    if (!orderAssignedToPartner(existing, scope)) {
      return jsonError("This order is not assigned to your delivery partner.", 403);
    }

    const body = await parseJson(request, actionSchema);

    if (body.action === "status") {
      const state = await getCodDeliveryState(id);
      if (!state.ok) return jsonError(state.message, state.status);
      return jsonOk({ cod: state.cod });
    }

    if (body.action === "resend_otp") {
      const result = await issueCodDeliveryOtp(id, { force: true });
      if (!result.ok) return jsonError(result.message, result.status);
      return jsonOk({
        cod: result.cod,
        order: await orderResponse(id),
        devCode: "devCode" in result ? result.devCode : undefined,
      });
    }

    if (body.action === "verify_otp") {
      const result = await verifyCodDeliveryOtp(id, body.code);
      if (!result.ok) return jsonError(result.message, result.status);
      return jsonOk({
        cod: result.cod,
        order: await orderResponse(id),
        alreadyVerified: result.alreadyVerified,
        autoDelivered: result.autoDelivered,
      });
    }

    if (body.action === "collect_cash") {
      const result = await markCodCashCollected(id, session.email);
      if (!result.ok) return jsonError(result.message, result.status);
      return jsonOk({
        cod: result.cod,
        order: await orderResponse(id),
        alreadyCollected: result.alreadyCollected,
        autoDelivered: result.autoDelivered,
      });
    }

    if (body.action === "upi_order") {
      const result = await createCodDoorstepUpiOrder(id, session.email);
      if (!result.ok) return jsonError(result.message, result.status);
      return jsonOk(result);
    }

    if (body.action === "upi_verify") {
      const result = await verifyCodDoorstepUpi({
        orderIdOrNumber: id,
        razorpay_order_id: body.razorpay_order_id,
        razorpay_payment_id: body.razorpay_payment_id,
        razorpay_signature: body.razorpay_signature,
        actorEmail: session.email,
      });
      if (!result.ok) return jsonError(result.message, result.status);
      return jsonOk({
        cod: result.cod,
        order: await orderResponse(id),
        alreadyVerified: result.alreadyVerified,
        autoDelivered: result.autoDelivered,
      });
    }

    return jsonError("Unsupported action", 400);
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "dispatch/orders/[id]/cod POST");
  }
}
