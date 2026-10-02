import { hasPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { loadCommerce } from "@/server/commerce-db";
import { loadCustomersForStaff } from "@/server/customers/load-customers";
import { handleApiError, isDbUnavailable, jsonError, jsonOk } from "@/server/http";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

async function allowStaffCustomers(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) return { ok: false as const, status: 401 as const };
  if (
    hasPermission(session.permissions, PERMISSIONS.CUSTOMER_VIEW) ||
    hasPermission(session.permissions, PERMISSIONS.ORDER_VIEW)
  ) {
    return { ok: true as const, session };
  }
  return { ok: false as const, status: 403 as const };
}

export async function GET(request: Request) {
  try {
    const auth = await allowStaffCustomers(request);
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

    const commerce = loadCommerce();
    let customers = await loadCustomersForStaff(commerce.customers ?? [], { take: 2000 });

    if (q) {
      customers = customers.filter(
        (c) =>
          c.email.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          (c.phone ?? "").toLowerCase().includes(q),
      );
    }

    const total = customers.length;
    const start = (page - 1) * limit;
    const pageCustomers = customers.slice(start, start + limit);

    return jsonOk({
      customers: pageCustomers,
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
        customers: (commerce.customers ?? []).slice(0, DEFAULT_LIMIT),
        total: commerce.customers?.length ?? 0,
        page: 1,
        limit: DEFAULT_LIMIT,
        pageSize: DEFAULT_LIMIT,
        source: "commerce",
      });
    }
    return handleApiError(error, "admin/customers GET");
  }
}
