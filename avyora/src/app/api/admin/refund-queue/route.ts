import { hasPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { ensureDb } from "@/server/db";
import { handleApiError, jsonError, jsonOk } from "@/server/http";
import { listPendingCancelRefundAlerts } from "@/server/orders/notify-paid-cancel-refund";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureDb();
    const session = await getSessionFromRequest(request);
    if (!session) return jsonError("Staff authentication required.", 401);
    if (
      !hasPermission(session.permissions, PERMISSIONS.ORDER_VIEW) &&
      !hasPermission(session.permissions, PERMISSIONS.ORDER_UPDATE) &&
      !hasPermission(session.permissions, PERMISSIONS.ORDER_REFUND)
    ) {
      return jsonError("Insufficient permissions.", 403);
    }

    const alerts = await listPendingCancelRefundAlerts(50);
    return jsonOk({ alerts, total: alerts.length });
  } catch (error) {
    return handleApiError(error, "admin/refund-queue GET");
  }
}
