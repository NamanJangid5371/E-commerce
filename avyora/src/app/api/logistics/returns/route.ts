import type { ReturnRequestStatus } from "@prisma/client";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { ensureDb } from "@/server/db";
import { handleApiError, jsonError, jsonOk } from "@/server/http";
import { canViewLogistics } from "@/server/logistics/auth";
import { listReturns } from "@/server/returns/return-service";

export const dynamic = "force-dynamic";

const LOGISTICS_STATUSES: ReturnRequestStatus[] = [
  "RETURN_APPROVED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "IN_TRANSIT",
  "RECEIVED_AT_WAREHOUSE",
  "INSPECTION_PENDING",
  "INSPECTION_APPROVED",
];

/**
 * Order page may also load pending requests (read-only) so logistics can see
 * “waiting for admin approval”. Actionable queue stays admin-approved+ only.
 */
const ORDER_PAGE_STATUSES: ReturnRequestStatus[] = [
  "RETURN_REQUESTED",
  ...LOGISTICS_STATUSES,
  "INSPECTION_REJECTED",
];

/** Logistics dashboard: approved returns awaiting pickup / warehouse. */
export async function GET(request: Request) {
  try {
    await ensureDb();
    const session = await getSessionFromRequest(request);
    if (!canViewLogistics(session)) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as ReturnRequestStatus | null;
    const q = searchParams.get("q") ?? undefined;
    const orderId = searchParams.get("orderId") ?? undefined;
    const page = Number(searchParams.get("page") ?? "1") || 1;
    // List queue: only admin-approved+. Order page: include RETURN_REQUESTED for wait messaging.
    const defaultStatuses = orderId ? ORDER_PAGE_STATUSES : LOGISTICS_STATUSES;

    const result = await listReturns({
      status:
        status && (orderId ? ORDER_PAGE_STATUSES : LOGISTICS_STATUSES).includes(status)
          ? status
          : defaultStatuses,
      q,
      orderId,
      page,
      pageSize: 50,
    });

    return jsonOk(result);
  } catch (error) {
    return handleApiError(error, "logistics/returns GET");
  }
}
