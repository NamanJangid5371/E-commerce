import { z } from "zod";
import type { ReturnRequestStatus } from "@prisma/client";
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
import { getReturnById, transitionReturn } from "@/server/returns/return-service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const actionSchema = z.object({
  action: z.enum([
    "schedule_pickup",
    "mark_picked_up",
    "mark_in_transit",
    "receive_warehouse",
    "approve_inspection",
    "reject_inspection",
  ]),
  note: z.string().trim().max(500).optional(),
  trackingNumber: z.string().trim().max(120).optional(),
  courier: z.string().trim().max(120).optional(),
  pickupNote: z.string().trim().max(500).optional(),
  inspectionNotes: z.string().trim().max(1000).optional(),
  /** Must be true when confirming warehouse receipt. */
  confirmProductMatch: z.boolean().optional(),
  expectedOrderItemId: z.string().optional(),
});

const ACTION_TO: Record<string, ReturnRequestStatus> = {
  schedule_pickup: "PICKUP_SCHEDULED",
  mark_picked_up: "PICKED_UP",
  mark_in_transit: "IN_TRANSIT",
  receive_warehouse: "RECEIVED_AT_WAREHOUSE",
  approve_inspection: "INSPECTION_APPROVED",
  reject_inspection: "INSPECTION_REJECTED",
};

export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const session = await getSessionFromRequest(request);
    if (!canViewLogistics(session)) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }
    const { id } = await context.params;
    const data = await getReturnById(id);
    if (!data) return jsonError("Return not found", 404);
    return jsonOk(data);
  } catch (error) {
    return handleApiError(error, "logistics/returns/[id] GET");
  }
}

/** Logistics: pickup → transit → warehouse → inspection. Cannot approve returns or refund. */
export async function POST(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const session = await getSessionFromRequest(request);
    if (!canManageLogistics(session)) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }

    const { id } = await context.params;
    const body = await parseJson(request, actionSchema);
    const to = ACTION_TO[body.action];
    if (!to) return jsonError("Unsupported action", 400);

    const result = await transitionReturn({
      id,
      to,
      role: "logistics",
      actorEmail: session.email,
      note: body.note,
      trackingNumber: body.trackingNumber,
      courier: body.courier,
      pickupNote: body.pickupNote,
      inspectionNotes: body.inspectionNotes,
      confirmProductMatch: body.confirmProductMatch,
      expectedOrderItemId: body.expectedOrderItemId,
    });
    if (!result.ok) return jsonError(result.message, result.status);
    return jsonOk(result.data);
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "logistics/returns/[id] POST");
  }
}
