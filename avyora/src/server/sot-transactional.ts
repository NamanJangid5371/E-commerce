import { loadCommerce, mutateCommerce, type CommerceSnapshot } from "@/server/commerce-db";
import { loadCustomersForStaff } from "@/server/customers/load-customers";
import { withLiveCatalogStock } from "@/server/inventory/sync-catalog-stock";
import { loadOrdersForStaff } from "@/server/orders/load-orders";
import { logger } from "@/server/logger";
import { getSotStatus } from "@/server/sot/transactional";

/**
 * Dual-store policy (orders & customers):
 * - PostgreSQL (Prisma) = source of truth
 * - data/commerce.json = best-effort mirror/cache for admin Zustand + logistics UI warmth
 *
 * Direction is always Postgres → JSON. Never the reverse for transactional domains.
 * Catalog/ops/coupons may still live primarily in commerce.json until migrated.
 */
export async function refreshTransactionalMirror(
  _snapshot?: CommerceSnapshot,
): Promise<CommerceSnapshot> {
  try {
    const [orders, customers] = await Promise.all([
      loadOrdersForStaff([], { take: 2000 }),
      loadCustomersForStaff([], { take: 2000 }),
    ]);
    return await mutateCommerce((current) => ({
      ...current,
      orders,
      customers: customers.map((c) => ({
        ...c,
        // Never persist secrets into the JSON mirror.
        password: undefined,
        resetToken: undefined,
        resetExpiresAt: undefined,
      })),
    }));
  } catch (error) {
    logger.warn("sot.refresh_transactional_mirror_failed", { error: String(error) });
    return _snapshot ?? loadCommerce();
  }
}

/**
 * Pull live Postgres stock into commerce.json catalog display fields (PG → JSON only).
 * Does not change ProductVariant.stock in Postgres.
 */
export async function mirrorInventoryDisplayFromPostgres(): Promise<CommerceSnapshot> {
  const current = loadCommerce();
  const withStock = await withLiveCatalogStock(current);
  return mutateCommerce((fresh) => ({
    ...fresh,
    catalog: withStock.catalog,
  }));
}

export { getSotStatus };
