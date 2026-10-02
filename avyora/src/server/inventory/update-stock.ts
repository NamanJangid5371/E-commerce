import { prisma } from "@/server/db";
import { mutateCommerce } from "@/server/commerce-db";

export type StockAdjustment = {
  sku: string;
  stock: number;
  reason?: string;
};

export type StockAdjustmentResult = {
  sku: string;
  previous: number;
  stock: number;
  delta: number;
};

/**
 * Set absolute on-hand stock for variants in Postgres (checkout SoT).
 * Optionally mirrors quantities into commerce.json so admin UI stays aligned.
 */
export async function applyStockAdjustments(
  adjustments: StockAdjustment[],
  actorEmail?: string,
  options?: { mirrorToCommerceJson?: boolean },
): Promise<StockAdjustmentResult[]> {
  const mirrorToCommerceJson = options?.mirrorToCommerceJson !== false;
  const results: StockAdjustmentResult[] = [];

  await prisma.$transaction(async (tx) => {
    let warehouse = await tx.warehouse.findFirst({ orderBy: { createdAt: "asc" } });
    if (!warehouse) {
      warehouse = await tx.warehouse.create({
        data: { name: "Main Warehouse", code: "MAIN", isDefault: true, active: true },
      });
    }

    for (const adjustment of adjustments) {
      const sku = adjustment.sku.trim();
      const stock = Math.max(0, Math.floor(adjustment.stock));
      const reason = (adjustment.reason?.trim() || "Manual adjustment").slice(0, 200);

      const variant = await tx.productVariant.findUnique({
        where: { sku },
        select: { id: true, stock: true, productId: true },
      });
      if (!variant) {
        throw new Error(`Unknown SKU: ${sku}`);
      }

      const previous = variant.stock;
      const delta = stock - previous;

      await tx.productVariant.update({
        where: { id: variant.id },
        data: { stock },
      });

      const inventory = await tx.inventory.upsert({
        where: {
          warehouseId_variantId: {
            warehouseId: warehouse.id,
            variantId: variant.id,
          },
        },
        create: {
          warehouseId: warehouse.id,
          productId: variant.productId,
          variantId: variant.id,
          quantity: stock,
          reserved: 0,
        },
        update: {
          quantity: stock,
        },
      });

      if (delta !== 0) {
        await tx.stockMovement.create({
          data: {
            inventoryId: inventory.id,
            delta,
            reason,
            actorEmail,
          },
        });
      }

      results.push({ sku, previous, stock, delta });
    }
  });

  // Mirror into commerce.json catalog (display / admin Zustand) under write lock.
  if (mirrorToCommerceJson) {
    try {
      const bySku = new Map(results.map((r) => [r.sku, r.stock]));
      await mutateCommerce((commerce) => {
        let changed = false;
        const catalog = commerce.catalog.map((product) => {
          let productChanged = false;
          const variants = product.variants.map((variant) => {
            const next = bySku.get(variant.sku);
            if (next === undefined || next === variant.stock) return variant;
            productChanged = true;
            changed = true;
            return { ...variant, stock: next };
          });
          return productChanged ? { ...product, variants } : product;
        });
        if (!changed) return;
        return { ...commerce, catalog };
      });
    } catch {
      /* mirror is best-effort */
    }
  }

  return results;
}
