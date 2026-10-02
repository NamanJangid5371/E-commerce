import { prisma } from "@/server/db";
import { hasPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { loadCommerce } from "@/server/commerce-db";
import { isDbUnavailable } from "@/server/http";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

const startedAt = Date.now();

function portalName() {
  const app = process.env.NEXT_PUBLIC_AVYORA_APP || process.env.AVYORA_APP || "store";
  if (app === "admin") return "admin";
  if (app === "logistics") return "logistics";
  return "store";
}

function line(name: string, value: number, labels?: Record<string, string>) {
  const labelText = labels
    ? `{${Object.entries(labels)
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
        .join(",")}}`
    : "";
  return `${name}${labelText} ${value}`;
}

/**
 * Prometheus-style text metrics.
 * Requires REPORT_VIEW — business counts must not be public.
 */
export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return Response.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required." } },
      { status: 401 },
    );
  }
  if (!hasPermission(session.permissions, PERMISSIONS.REPORT_VIEW)) {
    return Response.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Insufficient permissions." } },
      { status: 403 },
    );
  }

  const portal = portalName();
  const lines: string[] = [
    "# HELP avyora_up 1 if process is serving",
    "# TYPE avyora_up gauge",
    line("avyora_up", 1, { portal }),
    "# HELP avyora_uptime_seconds Process uptime",
    "# TYPE avyora_uptime_seconds counter",
    line("avyora_uptime_seconds", Math.round((Date.now() - startedAt) / 1000), { portal }),
  ];

  let dbUp = 0;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = 1;
    const [orders, customers, products] = await Promise.all([
      prisma.order.count(),
      prisma.customer.count(),
      prisma.product.count(),
    ]);
    lines.push("# HELP avyora_db_up 1 if database reachable");
    lines.push("# TYPE avyora_db_up gauge");
    lines.push(line("avyora_db_up", dbUp, { portal }));
    lines.push("# HELP avyora_orders_total Orders in Postgres");
    lines.push("# TYPE avyora_orders_total gauge");
    lines.push(line("avyora_orders_total", orders, { portal }));
    lines.push("# HELP avyora_customers_total Customers in Postgres");
    lines.push("# TYPE avyora_customers_total gauge");
    lines.push(line("avyora_customers_total", customers, { portal }));
    lines.push("# HELP avyora_products_total Products in Postgres");
    lines.push("# TYPE avyora_products_total gauge");
    lines.push(line("avyora_products_total", products, { portal }));
  } catch (error) {
    if (!isDbUnavailable(error)) {
      logger.warn("metrics.db_failed", { error: String(error) });
    }
    lines.push("# HELP avyora_db_up 1 if database reachable");
    lines.push("# TYPE avyora_db_up gauge");
    lines.push(line("avyora_db_up", 0, { portal }));
  }

  try {
    const commerce = loadCommerce();
    lines.push("# HELP avyora_commerce_orders_total Orders in commerce.json snapshot");
    lines.push("# TYPE avyora_commerce_orders_total gauge");
    lines.push(line("avyora_commerce_orders_total", commerce.orders?.length ?? 0, { portal }));
  } catch (error) {
    logger.warn("metrics.commerce_failed", { error: String(error) });
  }

  return new Response(`${lines.join("\n")}\n`, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
