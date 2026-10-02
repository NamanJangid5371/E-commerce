import type { ReturnRequestStatus } from "@prisma/client";
import { hasPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { ensureDb } from "@/server/db";
import { handleApiError, jsonError, jsonOk } from "@/server/http";
import { listReturns } from "@/server/returns/return-service";

export const dynamic = "force-dynamic";

async function allowReturns(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) return { ok: false as const, status: 401 as const };
  if (
    hasPermission(session.permissions, PERMISSIONS.ORDER_VIEW) ||
    hasPermission(session.permissions, PERMISSIONS.ORDER_UPDATE) ||
    hasPermission(session.permissions, PERMISSIONS.ORDER_REFUND)
  ) {
    return { ok: true as const, session };
  }
  return { ok: false as const, status: 403 as const };
}

/** Admin return management list with filters. */
export async function GET(request: Request) {
  try {
    await ensureDb();
    const auth = await allowReturns(request);
    if (!auth.ok) {
      return jsonError(
        auth.status === 401 ? "Staff authentication required." : "Insufficient permissions.",
        auth.status,
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as ReturnRequestStatus | null;
    const q = searchParams.get("q") ?? undefined;
    const orderId = searchParams.get("orderId") ?? undefined;
    const page = Number(searchParams.get("page") ?? "1") || 1;
    const pageSize = Number(searchParams.get("pageSize") ?? "50") || 50;
    const fromRaw = searchParams.get("from");
    const toRaw = searchParams.get("to");

    const result = await listReturns({
      status: status || undefined,
      q,
      orderId,
      page,
      pageSize,
      from: fromRaw ? new Date(fromRaw) : undefined,
      to: toRaw ? new Date(toRaw) : undefined,
    });

    return jsonOk(result);
  } catch (error) {
    return handleApiError(error, "admin/returns GET");
  }
}
