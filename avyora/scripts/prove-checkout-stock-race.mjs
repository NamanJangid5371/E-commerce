/**
 * Proof: two concurrent reserveStockInTransaction calls against stock=1
 * → exactly one winner, final stock >= 0 (no oversell).
 *
 * Usage: node --import tsx scripts/prove-checkout-stock-race.mjs
 * (or: npx tsx scripts/prove-checkout-stock-race.mjs)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const { reserveStockInTransaction, InsufficientStockError } = await import(
    "../src/server/checkout/reserve-stock.ts"
  );

  const marker = `race-proof-${Date.now()}`;
  const product = await prisma.product.create({
    data: {
      sku: `${marker}-p`,
      slug: marker,
      name: "Stock race proof",
      description: "temp",
      metal: "gold",
      purity: "18K",
      colour: "yellow",
      makingCharge: 0,
      variants: {
        create: {
          sku: `${marker}-v`,
          metal: "gold",
          purity: "18K",
          colour: "yellow",
          stock: 1,
          price: 100,
        },
      },
    },
    include: { variants: true },
  });
  const variantId = product.variants[0].id;

  const results = await Promise.allSettled([
    prisma.$transaction((tx) =>
      reserveStockInTransaction(tx, [{ variantId, quantity: 1, label: "A" }], "race-a", {
        orderId: `race-a-${marker}`,
      }),
    ),
    prisma.$transaction((tx) =>
      reserveStockInTransaction(tx, [{ variantId, quantity: 1, label: "B" }], "race-b", {
        orderId: `race-b-${marker}`,
      }),
    ),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r) => r.status === "rejected");
  const stockErrors = rejected.filter(
    (r) => r.reason instanceof InsufficientStockError || String(r.reason).includes("Insufficient stock"),
  );

  const final = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });

  // Cleanup
  const inv = await prisma.inventory.findMany({ where: { variantId } });
  for (const row of inv) {
    await prisma.stockMovement.deleteMany({ where: { inventoryId: row.id } });
  }
  await prisma.inventory.deleteMany({ where: { variantId } });
  await prisma.productVariant.delete({ where: { id: variantId } });
  await prisma.product.delete({ where: { id: product.id } });

  const ok = fulfilled === 1 && stockErrors.length === 1 && final.stock === 0;

  console.log(
    JSON.stringify(
      {
        proof: "checkout_stock_race",
        ok,
        fulfilled,
        rejected: rejected.length,
        stockErrors: stockErrors.length,
        finalStock: final.stock,
        detail: results.map((r) =>
          r.status === "fulfilled"
            ? { status: "fulfilled" }
            : { status: "rejected", reason: String(r.reason?.message ?? r.reason) },
        ),
      },
      null,
      2,
    ),
  );

  if (!ok) process.exit(1);
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ proof: "checkout_stock_race", ok: false, error: String(error) }));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
