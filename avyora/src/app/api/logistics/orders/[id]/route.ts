import { LOGISTICS_STATUSES } from "@/lib/logistics-orders";
import type { Order } from "@/store/shop-types";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { assertCodDeliveryCompletable, attachCodToClientOrder, issueCodDeliveryOtp } from "@/server/cod/service";
import { ensureDb } from "@/server/db";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import { canManageLogistics, canViewLogistics } from "@/server/logistics/auth";
import { findOpsOrder, patchLogisticsOrder, persistOrder } from "@/server/logistics/mutations";
import { notifyLogisticsStatusChange } from "@/server/logistics/notify";
import { isCodPaymentMethod } from "@/lib/payment-method";
import { z } from "zod";

export const dynamic = "force-dynamic";

const statusEnum = z.enum(LOGISTICS_STATUSES as [string, ...string[]]);

const patchSchema = z.object({
  status: statusEnum.optional(),
  shipmentId: z.string().optional(),
  trackingId: z.string().optional(),
  deliveryPartner: z.string().optional(),
  estimatedShippingDate: z.string().optional(),
  estimatedDeliveryDate: z.string().optional(),
  location: z.string().optional(),
  note: z.string().optional(),
  returnReason: z.string().max(500).optional(),
  generateRefund: z.boolean().optional(),
  refundedAmount: z.number().positive().optional(),
  paymentStatus: z.enum(["Success", "Pending", "Failed"]).optional(),
  collectCod: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const session = await getSessionFromRequest(request);
    if (!canViewLogistics(session)) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }

    const { id } = await context.params;
    const { order } = await findOpsOrder(id);
    if (!order) return jsonError("Order not found", 404);
    return jsonOk(await attachCodToClientOrder(order));
  } catch (error) {
    return handleApiError(error, "logistics/orders/[id] GET");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const session = await getSessionFromRequest(request);
    if (!canManageLogistics(session) || !session) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }

    const body = await parseJson(request, patchSchema);
    const { id } = await context.params;
    const { order } = await findOpsOrder(id);
    if (!order) return jsonError("Order not found", 404);

    if (body.status === "Return Requested") {
      return jsonError(
        "Return requests can only be submitted by the customer. Logistics cannot initiate returns.",
        400,
      );
    }
    if (body.generateRefund || body.status === "Refunded") {
      return jsonError(
        "Refunds are issued from the admin panel after a customer return request.",
        400,
      );
    }

    // COD cash collection must go through the verified COD service (OTP + exclusive cash/UPI).
    if (body.collectCod || body.paymentStatus === "Success") {
      return jsonError(
        'Use COD actions: POST /api/logistics/orders/{id}/cod with action "collect_cash" or "upi_verify".',
        400,
      );
    }

    if (body.status === "Delivered" && isCodPaymentMethod(order.paymentMethod)) {
      const gate = await assertCodDeliveryCompletable(id);
      if (!gate.ok) return jsonError(gate.message, 409);
    }

    const result = patchLogisticsOrder(order, {
      status: body.status as Order["status"] | undefined,
      shipmentId: body.shipmentId,
      trackingId: body.trackingId,
      deliveryPartner: body.deliveryPartner,
      estimatedShippingDate: body.estimatedShippingDate,
      estimatedDeliveryDate: body.estimatedDeliveryDate,
      location: body.location,
      note: body.note,
      returnReason: body.returnReason,
      paymentStatus: body.paymentStatus,
      collectCod: false,
      updatedBy: session.email,
    });

    if (!result.ok) return jsonError(result.message, 400);

    const saved = await persistOrder(id, result.order, session.email);
    const statusChanged = saved.status !== order.status;
    if (statusChanged) {
      void notifyLogisticsStatusChange(saved, saved.status);
      if (saved.status === "Out for Delivery" && isCodPaymentMethod(saved.paymentMethod)) {
        void issueCodDeliveryOtp(id).catch(() => undefined);
      }
    }
    return jsonOk(await attachCodToClientOrder(saved));
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "logistics/orders/[id] PATCH");
  }
}
