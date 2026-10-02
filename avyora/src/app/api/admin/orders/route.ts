import { hasPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { loadCommerce } from "@/server/commerce-db";
import { loadOrdersForStaff } from "@/server/orders/load-orders";
import { handleApiError, isDbUnavailable, jsonError, jsonOk } from "@/server/http";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

async function allowStaffOrders(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) return { ok: false as const, status: 401 as const };
  if (
    hasPermission(session.permissions, PERMISSIONS.ORDER_VIEW) ||
    hasPermission(session.permissions, PERMISSIONS.ORDER_UPDATE)
  ) {
    return { ok: true as const, session };
  }
  return { ok: false as const, status: 403 as const };
}

export async function GET(request: Request) {
  try {
    const auth = await allowStaffOrders(request);
    if (!auth.ok) {
      return jsonError(
        auth.status === 401 ? "Staff authentication required." : "Insufficient permissions.",
        auth.status,
      );
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
    const requested = Number(searchParams.get("limit") ?? searchParams.get("pageSize") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT;
    const limit = Math.min(MAX_LIMIT, Math.max(1, requested));
    const q = (searchParams.get("q") ?? "").trim().toLowerCase();
    const status = (searchParams.get("status") ?? "").trim();

    const commerce = loadCommerce();
    let orders = await loadOrdersForStaff(commerce.orders ?? [], { take: 2000 });

    if (status) {
      orders = orders.filter((o) => o.status === status);
    }
    if (q) {
      orders = orders.filter(
        (o) =>
          o.id.toLowerCase().includes(q) ||
          (o.customerEmail ?? "").toLowerCase().includes(q) ||
          o.address?.name?.toLowerCase().includes(q) ||
          o.paymentId?.toLowerCase().includes(q),
      );
    }

    const total = orders.length;
    const start = (page - 1) * limit;
    const pageOrders = orders.slice(start, start + limit);

    return jsonOk({
      orders: pageOrders,
      total,
      page,
      limit,
      pageSize: limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    if (isDbUnavailable(error)) {
      const commerce = loadCommerce();
      return jsonOk({
        orders: (commerce.orders ?? []).slice(0, DEFAULT_LIMIT),
        total: commerce.orders?.length ?? 0,
        page: 1,
        limit: DEFAULT_LIMIT,
        pageSize: DEFAULT_LIMIT,
        source: "commerce",
      });
    }
    return handleApiError(error, "admin/orders GET");
  }
}
