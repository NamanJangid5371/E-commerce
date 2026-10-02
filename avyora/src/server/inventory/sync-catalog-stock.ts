import { prisma } from "@/server/db";
import type { CommerceSnapshot } from "@/server/commerce-db";
import { applyStockAdjustments } from "@/server/inventory/update-stock";
import { logger } from "@/server/logger";
import { isJsonStockPushToPostgresEnabled } from "@/server/sot/transactional";

/**
 * Overlay live Postgres stock onto a commerce catalog snapshot.
 * Checkout already uses Postgres; this keeps storefront/admin displays truthful.
 * Direction: PostgreSQL → display snapshot only.
 */
export async function withLiveCatalogStock(
  snapshot: CommerceSnapshot,
): Promise<CommerceSnapshot> {
  try {
    const skus = snapshot.catalog.flatMap((p) => p.variants.map((v) => v.sku));
    if (!skus.length) return snapshot;

    const rows = await prisma.productVariant.findMany({
      where: { sku: { in: [...new Set(skus)] } },
      select: { sku: true, stock: true },
    });
    if (!rows.length) return snapshot;

    const bySku = new Map(rows.map((r) => [r.sku, r.stock]));
    return {
      ...snapshot,
      catalog: snapshot.catalog.map((product) => ({
        ...product,
        variants: product.variants.map((variant) => {
          const live = bySku.get(variant.sku);
          return live === undefined ? variant : { ...variant, stock: live };
        }),
      })),
    };
  } catch (error) {
    logger.warn("inventory.overlay_live_stock_failed", { error: String(error) });
    return snapshot;
  }
}

/**
 * Push catalog variant stock levels into Postgres.
 * DISABLED by default — commerce.json / Zustand must not overwrite checkout SoT.
 * Opt-in only via ALLOW_JSON_STOCK_PUSH_TO_POSTGRES=true (non-production).
 */
export async function syncCatalogStockToPostgres(
  snapshot: CommerceSnapshot,
  actorEmail?: string,
  options?: { mirrorToCommerceJson?: boolean; force?: boolean },
): Promise<number> {
  if (!options?.force && !isJsonStockPushToPostgresEnabled()) {
    logger.info("inventory.json_stock_push_blocked", {
      actor: actorEmail,
      reason: "PostgreSQL is inventory SoT; set ALLOW_JSON_STOCK_PUSH_TO_POSTGRES=true only for emergency repair in non-prod.",
    });
    return 0;
  }

  const adjustments = snapshot.catalog.flatMap((product) =>
    product.variants.map((variant) => ({
      sku: variant.sku,
      stock: Math.max(0, Math.floor(Number(variant.stock) || 0)),
      reason: "catalog_sync",
    })),
  );

  if (!adjustments.length) return 0;

  // Only update SKUs that exist in Postgres; skip unknown quietly.
  const existing = await prisma.productVariant.findMany({
    where: { sku: { in: adjustments.map((a) => a.sku) } },
    select: { sku: true, stock: true },
  });
  const current = new Map(existing.map((r) => [r.sku, r.stock]));
  const changed = adjustments.filter((a) => {
    const prev = current.get(a.sku);
    return prev !== undefined && prev !== a.stock;
  });

  if (!changed.length) return 0;

  // Chunk to stay within transaction limits.
  const chunkSize = 50;
  let updated = 0;
  for (let i = 0; i < changed.length; i += chunkSize) {
    const chunk = changed.slice(i, i + chunkSize);
    const results = await applyStockAdjustments(chunk, actorEmail, {
      mirrorToCommerceJson: options?.mirrorToCommerceJson,
    });
    updated += results.length;
  }
  return updated;
}
