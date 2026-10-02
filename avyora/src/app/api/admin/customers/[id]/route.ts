import { hasPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { loadCustomerWithPurchaseHistory } from "@/server/customers/load-customer-orders";
import { ensureDb } from "@/server/db";
import { handleApiError, jsonError, jsonOk } from "@/server/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function allowStaffCustomerDetail(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) return { ok: false as const, status: 401 as const };
  if (
    hasPermission(session.permissions, PERMISSIONS.CUSTOMER_VIEW) ||
    hasPermission(session.permissions, PERMISSIONS.ORDER_VIEW) ||
    hasPermission(session.permissions, PERMISSIONS.CUSTOMER_UPDATE)
  ) {
    return { ok: true as const, session };
  }
  return { ok: false as const, status: 403 as const };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const auth = await allowStaffCustomerDetail(request);
    if (!auth.ok) {
      return jsonError(
        auth.status === 401 ? "Staff authentication required." : "Insufficient permissions.",
        auth.status,
      );
    }

    const { id } = await context.params;
    const decoded = decodeURIComponent(id);
    const data = await loadCustomerWithPurchaseHistory(decoded);
    if (!data) return jsonError("Customer not found.", 404);

    return jsonOk(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cod_delivery_verifications|Unknown field `codDelivery`|P2021|P2022/i.test(message)) {
      return jsonError(
        "Database schema is out of date for COD delivery. Run: npx prisma migrate deploy && npx prisma generate, then restart the app.",
        503,
      );
    }
    return handleApiError(error, "admin/customers/[id] GET");
  }
}
