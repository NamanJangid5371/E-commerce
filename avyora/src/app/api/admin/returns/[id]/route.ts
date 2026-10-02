import { z } from "zod";
import type { ReturnRequestStatus } from "@prisma/client";
import { hasPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { ensureDb } from "@/server/db";
import {
  handleApiError,
  HttpParseError,
  jsonError,
  jsonOk,
  parseJson,
} from "@/server/http";
import {
  getReturnById,
  initiateRefund,
  transitionReturn,
} from "@/server/returns/return-service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("reject"),
    note: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal("mark_refund_eligible"),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("refund"),
    amount: z.number().positive().optional(),
    reason: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("transition"),
    to: z.string(),
    note: z.string().trim().max(500).optional(),
  }),
]);

async function allowManage(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) return { ok: false as const, status: 401 as const, session: null };
  if (
    hasPermission(session.permissions, PERMISSIONS.ORDER_UPDATE) ||
    hasPermission(session.permissions, PERMISSIONS.ORDER_REFUND)
  ) {
    return { ok: true as const, session };
  }
  return { ok: false as const, status: 403 as const, session };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const auth = await allowManage(request);
    if (!auth.ok || !auth.session) {
      return jsonError(
        auth.status === 401 ? "Staff authentication required." : "Insufficient permissions.",
        auth.status,
      );
    }
    const { id } = await context.params;
    const data = await getReturnById(id);
    if (!data) return jsonError("Return not found", 404);
    return jsonOk(data);
  } catch (error) {
    return handleApiError(error, "admin/returns/[id] GET");
  }
}

/**
 * Admin-only decisions: approve/reject return, mark refund eligible, initiate refund.
 * Pickup / warehouse / inspection are logistics-owned.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const auth = await allowManage(request);
    if (!auth.ok || !auth.session) {
      return jsonError(
        auth.status === 401 ? "Staff authentication required." : "Insufficient permissions.",
        auth.status,
      );
    }

    const { id } = await context.params;
    const body = await parseJson(request, actionSchema);

    if (body.action === "refund") {
      if (
        !hasPermission(auth.session.permissions, PERMISSIONS.ORDER_REFUND) &&
        !hasPermission(auth.session.permissions, PERMISSIONS.ORDER_UPDATE)
      ) {
        return jsonError("Insufficient permissions to issue refunds.", 403);
      }
      const result = await initiateRefund({
        id,
        actorEmail: auth.session.email,
        amount: body.amount,
        reason: body.reason,
      });
      if (!result.ok) return jsonError(result.message, result.status);
      return jsonOk(result.data);
    }

    const toMap: Record<string, ReturnRequestStatus> = {
      approve: "RETURN_APPROVED",
      reject: "RETURN_REJECTED",
      mark_refund_eligible: "REFUND_ELIGIBLE",
    };

    const to =
      body.action === "transition"
        ? (body.to as ReturnRequestStatus)
        : toMap[body.action];

    if (!to) return jsonError("Unsupported action", 400);

    // Guard: admin cannot drive logistics stages, and cannot fake refund completion
    // via transition — payouts must use action: "refund" → initiateRefund.
    const adminAllowed = new Set<ReturnRequestStatus>([
      "RETURN_APPROVED",
      "RETURN_REJECTED",
      "RETURN_CANCELLED",
      "REFUND_ELIGIBLE",
    ]);
    if (to === "REFUND_INITIATED" || to === "REFUND_COMPLETED") {
      return jsonError(
        'Use action "refund" to initiate a payout after warehouse receipt and inspection.',
        400,
      );
    }
    if (!adminAllowed.has(to)) {
      return jsonError(
        "This status is updated by logistics (pickup, warehouse, inspection).",
        400,
      );
    }

    const result = await transitionReturn({
      id,
      to,
      role: "admin",
      actorEmail: auth.session.email,
      note: "note" in body ? body.note : undefined,
    });
    if (!result.ok) return jsonError(result.message, result.status);
    return jsonOk(result.data);
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "admin/returns/[id] POST");
  }
}
