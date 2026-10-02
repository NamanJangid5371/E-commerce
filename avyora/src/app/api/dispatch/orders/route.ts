import { orderSearchText } from "@/lib/logistics-orders";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { loadCommerce } from "@/server/commerce-db";
import {
  canAccessDispatch,
  orderAssignedToPartner,
  resolveDispatchPartnerScope,
} from "@/server/dispatch/auth";
import { ensureDb } from "@/server/db";
import { handleApiError, jsonError, jsonOk } from "@/server/http";
import { attachCodToClientOrder } from "@/server/cod/service";
import { loadOrdersForStaff } from "@/server/orders/load-orders";

export const dynamic = "force-dynamic";

/** Local dispatch queue — 3rd-party partners only see orders assigned to them. */
export async function GET(request: Request) {
  try {
    await ensureDb();
    const session = await getSessionFromRequest(request);
    if (!canAccessDispatch(session) || !session) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }

    const scope = resolveDispatchPartnerScope(session);
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "50")));

    const commerce = loadCommerce();
    let orders = await loadOrdersForStaff(commerce.orders ?? [], { take: 2000 });

    orders = orders.filter((order) => orderAssignedToPartner(order, scope));
    if (q) {
      orders = orders.filter((order) => orderSearchText(order).includes(q));
    }

    // Prefer last-mile jobs first.
    const rank = (status: string) => {
      if (status === "Out for Delivery") return 0;
      if (status === "Failed Delivery") return 1;
      if (status === "In Transit" || status === "Shipped") return 2;
      if (status === "Ready to Ship" || status === "Packed") return 3;
      return 4;
    };
    orders.sort(
      (a, b) =>
        rank(a.status) - rank(b.status) ||
        +new Date(b.lastUpdatedAt ?? b.createdAt) - +new Date(a.lastUpdatedAt ?? a.createdAt),
    );

    const total = orders.length;
    const slice = orders.slice((page - 1) * pageSize, page * pageSize);
    const withCod = await Promise.all(slice.map((o) => attachCodToClientOrder(o)));

    return jsonOk({
      orders: withCod,
      total,
      page,
      pageSize,
      scope: {
        partnerName: scope.partnerName,
        partner: scope.partner
          ? {
              id: scope.partner.id,
              name: scope.partner.name,
              email: scope.partner.email,
              phone: scope.partner.phone,
            }
          : null,
        isOpsOverseer: scope.isOpsOverseer,
      },
    });
  } catch (error) {
    return handleApiError(error, "dispatch/orders GET");
  }
}
