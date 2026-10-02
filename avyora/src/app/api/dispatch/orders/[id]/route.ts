import { z } from "zod";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { attachCodToClientOrder } from "@/server/cod/service";
import {
  canManageDispatchJobs,
  orderAssignedToPartner,
  resolveDispatchPartnerScope,
} from "@/server/dispatch/auth";
import { ensureDb } from "@/server/db";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import { findOpsOrder, patchLogisticsOrder, persistOrder } from "@/server/logistics/mutations";
import { notifyLogisticsStatusChange } from "@/server/logistics/notify";
import { isCodPaymentMethod } from "@/lib/payment-method";
import { assertCodDeliveryCompletable, issueCodDeliveryOtp } from "@/server/cod/service";
import type { Order } from "@/store/shop-types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Last-mile statuses partners may set (warehouse packing stays on logistics). */
const DISPATCH_STATUSES = [
  "Out for Delivery",
  "Delivered",
  "Failed Delivery",
  "In Transit",
] as const;

const patchSchema = z.object({
  status: z.enum(DISPATCH_STATUSES).optional(),
  location: z.string().optional(),
  note: z.string().optional(),
});

export async function GET(request: Request, context: RouteContext) {
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
    return jsonOk({
      order: await attachCodToClientOrder(order),
      scope: {
        partnerName: scope.partnerName,
        partner: scope.partner
          ? { id: scope.partner.id, name: scope.partner.name, email: scope.partner.email, phone: scope.partner.phone }
          : null,
        isOpsOverseer: scope.isOpsOverseer,
      },
    });
  } catch (error) {
    return handleApiError(error, "dispatch/orders/[id] GET");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
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

    const body = await parseJson(request, patchSchema);
    if (body.status === "Delivered" && isCodPaymentMethod(order.paymentMethod)) {
      const gate = await assertCodDeliveryCompletable(id);
      if (!gate.ok) return jsonError(gate.message, 409);
    }

    const result = patchLogisticsOrder(order, {
      status: body.status as Order["status"] | undefined,
      location: body.location,
      note: body.note,
      updatedBy: session.email,
    });
    if (!result.ok) return jsonError(result.message, 400);

    const saved = await persistOrder(id, result.order, session.email);
    if (saved.status !== order.status) {
      void notifyLogisticsStatusChange(saved, saved.status);
      if (saved.status === "Out for Delivery" && isCodPaymentMethod(saved.paymentMethod)) {
        void issueCodDeliveryOtp(id).catch(() => undefined);
      }
    }
    return jsonOk({ order: await attachCodToClientOrder(saved) });
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "dispatch/orders/[id] PATCH");
  }
}
