import { z } from "zod";
import { hasPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import {
  handleApiError,
  HttpParseError,
  isDbUnavailable,
  jsonError,
  jsonOk,
  parseJson,
} from "@/server/http";
import { applyStockAdjustments } from "@/server/inventory/update-stock";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  adjustments: z
    .array(
      z.object({
        sku: z.string().min(1),
        stock: z.number().int().min(0),
        reason: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(200),
  reason: z.string().max(200).optional(),
});

async function requireInventoryWrite(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) return { ok: false as const, status: 401 as const };
  if (
    hasPermission(session.permissions, PERMISSIONS.INVENTORY_UPDATE) ||
    hasPermission(session.permissions, PERMISSIONS.PRODUCT_UPDATE)
  ) {
    return { ok: true as const, session };
  }
  return { ok: false as const, status: 403 as const };
}

/** Staff: list live Postgres stock (checkout source of truth). */
export async function GET(request: Request) {
  try {
    const auth = await requireInventoryWrite(request);
    // Viewers with INVENTORY_VIEW may also list.
    if (!auth.ok) {
      const session = await getSessionFromRequest(request);
      if (!session) return jsonError("Staff authentication required.", 401);
      if (
        !hasPermission(session.permissions, PERMISSIONS.INVENTORY_VIEW) &&
        !hasPermission(session.permissions, PERMISSIONS.PRODUCT_VIEW)
      ) {
        return jsonError("Insufficient permissions.", 403);
      }
    }

    const variants = await prisma.productVariant.findMany({
      select: {
        sku: true,
        stock: true,
        product: { select: { name: true, legacyId: true } },
      },
      orderBy: { sku: "asc" },
      take: 2000,
    });

    return jsonOk({
      variants: variants.map((v) => ({
        sku: v.sku,
        stock: v.stock,
        name: v.product.name,
        productLegacyId: v.product.legacyId,
      })),
    });
  } catch (error) {
    if (isDbUnavailable(error)) {
      return jsonError("Database unavailable.", 503);
    }
    return handleApiError(error, "admin/inventory GET");
  }
}

/** Staff: set absolute stock levels in Postgres (checkout source of truth). */
export async function PATCH(request: Request) {
  try {
    const auth = await requireInventoryWrite(request);
    if (!auth.ok) {
      return jsonError(
        auth.status === 401 ? "Staff authentication required." : "Insufficient permissions.",
        auth.status,
      );
    }

    const body = await parseJson(request, bodySchema);
    const defaultReason = body.reason?.trim() || "Manual adjustment";
    const adjustments = body.adjustments.map((row) => ({
      ...row,
      reason: row.reason?.trim() || defaultReason,
    }));

    const results = await applyStockAdjustments(adjustments, auth.session.email);
    return jsonOk({
      updated: results.length,
      results,
    });
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    if (error instanceof Error && error.message.startsWith("Unknown SKU:")) {
      return jsonError(error.message, 404);
    }
    if (isDbUnavailable(error)) {
      return jsonError("Database unavailable. Inventory was not updated.", 503);
    }
    return handleApiError(error, "admin/inventory PATCH");
  }
}

/**
 * Emergency-only: push commerce.json catalog stock into Postgres.
 * Disabled by default — PostgreSQL is inventory SoT. Prefer PATCH with explicit SKUs.
 * Requires ALLOW_JSON_STOCK_PUSH_TO_POSTGRES=true (non-production).
 */
export async function POST(request: Request) {
  try {
    const auth = await requireInventoryWrite(request);
    if (!auth.ok) {
      return jsonError(
        auth.status === 401 ? "Staff authentication required." : "Insufficient permissions.",
        auth.status,
      );
    }

    const body = (await request.json().catch(() => ({}))) as { mode?: string };
    if (body.mode !== "sync-from-catalog") {
      return jsonError('Expected { "mode": "sync-from-catalog" }.', 400);
    }

    const { isJsonStockPushToPostgresEnabled, getSotStatus } = await import(
      "@/server/sot/transactional"
    );
    if (!isJsonStockPushToPostgresEnabled()) {
      return jsonError(
        "JSON→Postgres stock push is disabled. PostgreSQL is inventory SoT. Use PATCH /api/admin/inventory with explicit SKU stock levels. (Emergency non-prod: set ALLOW_JSON_STOCK_PUSH_TO_POSTGRES=true.)",
        403,
        { sot: getSotStatus() },
      );
    }

    const { loadCommerce } = await import("@/server/commerce-db");
    const { syncCatalogStockToPostgres } = await import("@/server/inventory/sync-catalog-stock");
    const commerce = loadCommerce();
    const updated = await syncCatalogStockToPostgres(commerce, auth.session.email);

    return jsonOk({
      updated,
      sot: getSotStatus(),
      message:
        updated > 0
          ? `Emergency sync: ${updated} variant stock level(s) pushed into Postgres.`
          : "Live checkout stock already matches the catalog file.",
    });
  } catch (error) {
    if (isDbUnavailable(error)) {
      return jsonError("Database unavailable. Inventory was not updated.", 503);
    }
    return handleApiError(error, "admin/inventory POST");
  }
}
