import { PERMISSIONS } from "@/server/auth/permissions";
import { requirePermission } from "@/server/auth/rbac";
import { computeMarginMetrics } from "@/server/analytics/forecasting";
import { ensureDb, prisma } from "@/server/db";
import { handleApiError, jsonOk } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureDb();
    await requirePermission(request, PERMISSIONS.REPORT_VIEW);

    const url = new URL(request.url);
    const days = Math.min(Number(url.searchParams.get("days") ?? 90), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: since },
        status: { in: ["DELIVERED", "SHIPPED", "CONFIRMED", "PAYMENT_CONFIRMED"] },
      },
      include: {
        items: {
          include: {
            product: { select: { makingCharge: true } },
          },
        },
      },
    });

    const marginOrders = orders.map((order) => ({
      id: order.id,
      total: Number(order.total),
      subtotal: Number(order.subtotal),
      discount: Number(order.discount),
      shipping: Number(order.shipping),
      tax: Number(order.tax),
      items: order.items.map((item) => ({
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        cost: item.product?.makingCharge ? Number(item.product.makingCharge) : undefined,
      })),
    }));

    const metrics = computeMarginMetrics(marginOrders);

    return jsonOk({
      periodDays: days,
      since: since.toISOString(),
      metrics,
    });
  } catch (error) {
    return handleApiError(error, "admin/analytics/margin GET");
  }
}
