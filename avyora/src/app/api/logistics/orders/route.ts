import { isDelayedShipment, LOGISTICS_STATUSES, orderSearchText } from "@/lib/logistics-orders";
import { isCodPaymentMethod } from "@/lib/payment-method";
import type { Order, OrderStatus } from "@/store/shop-types";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { assertCodDeliveryCompletable, issueCodDeliveryOtp } from "@/server/cod/service";
import { loadCommerce } from "@/server/commerce-db";
import { ensureDb } from "@/server/db";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import { canManageLogistics, canViewLogistics } from "@/server/logistics/auth";
import { findOpsOrder, patchLogisticsOrder, persistOrder } from "@/server/logistics/mutations";
import { loadOrdersForStaff } from "@/server/orders/load-orders";
import { z } from "zod";

export const dynamic = "force-dynamic";

const statusEnum = z.enum(LOGISTICS_STATUSES as [string, ...string[]]);

const bulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  action: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("status"),
      status: statusEnum,
    }),
    z.object({
      kind: z.literal("partner"),
      deliveryPartner: z.string().min(1),
    }),
  ]),
});

export async function GET(request: Request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!canViewLogistics(session)) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }

    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const status = url.searchParams.get("status")?.trim();
    const payment = url.searchParams.get("payment")?.trim();
    const partner = url.searchParams.get("partner")?.trim();
    const delayed = url.searchParams.get("delayed")?.trim();
    const from = url.searchParams.get("from")?.trim();
    const to = url.searchParams.get("to")?.trim();
    const sort = url.searchParams.get("sort")?.trim() ?? "updated-desc";
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "20")));
    const commerce = loadCommerce();
    // Postgres is SoT; JSON is offline fallback inside loadOrdersForStaff.
    const allOrders = await loadOrdersForStaff(commerce.orders ?? []);

    const data = allOrders
      .filter((order) => {
        if (status && status !== "all" && order.status !== status) return false;
        if (payment && payment !== "all" && (order.paymentStatus ?? "Success") !== payment) return false;
        if (partner && partner !== "all" && (order.deliveryPartner ?? "Unassigned") !== partner) return false;
        if (delayed === "true" && !isDelayedShipment(order)) return false;
        if (delayed === "false" && isDelayedShipment(order)) return false;
        if (from && +new Date(order.createdAt) < +new Date(from)) return false;
        if (to && +new Date(order.createdAt) > +new Date(`${to}T23:59:59`)) return false;
        if (q && !orderSearchText(order).includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "created-desc") return +new Date(b.createdAt) - +new Date(a.createdAt);
        if (sort === "eta-asc") return +(new Date(a.estimatedDeliveryDate ?? "9999-12-31")) - +(new Date(b.estimatedDeliveryDate ?? "9999-12-31"));
        if (sort === "value-desc") return b.total - a.total;
        if (sort === "id-asc") return a.id.localeCompare(b.id);
        return +new Date(b.lastUpdatedAt ?? b.createdAt) - +new Date(a.lastUpdatedAt ?? a.createdAt);
      });

    const paginated = data.slice((page - 1) * pageSize, page * pageSize);

    return jsonOk({
      orders: paginated,
      total: data.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(data.length / pageSize)),
      updatedAt: commerce.updatedAt,
      source: "postgres",
    });
  } catch (error) {
    return handleApiError(error, "logistics/orders GET");
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureDb();
    const session = await getSessionFromRequest(request);
    if (!canManageLogistics(session) || !session) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }

    const body = await parseJson(request, bulkSchema);
    const updated: Order[] = [];
    let success = 0;
    let failed = 0;

    for (const id of body.ids) {
      const { order } = await findOpsOrder(id);
      if (!order) {
        failed += 1;
        continue;
      }

      if (
        body.action.kind === "status" &&
        body.action.status === "Delivered" &&
        isCodPaymentMethod(order.paymentMethod)
      ) {
        const gate = await assertCodDeliveryCompletable(id);
        if (!gate.ok) {
          failed += 1;
          continue;
        }
      }

      const result =
        body.action.kind === "status"
          ? patchLogisticsOrder(order, {
              status: body.action.status as OrderStatus,
              updatedBy: session.email,
            })
          : patchLogisticsOrder(order, {
              deliveryPartner: body.action.deliveryPartner,
              updatedBy: session.email,
            });

      if (!result.ok) {
        failed += 1;
        continue;
      }

      const saved = await persistOrder(id, result.order, session.email);
      if (
        body.action.kind === "status" &&
        saved.status === "Out for Delivery" &&
        saved.status !== order.status &&
        isCodPaymentMethod(saved.paymentMethod)
      ) {
        void issueCodDeliveryOtp(id).catch(() => undefined);
      }
      success += 1;
      updated.push(saved);
    }

    return jsonOk({ success, failed, orders: updated });
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "logistics/orders PATCH bulk");
  }
}
