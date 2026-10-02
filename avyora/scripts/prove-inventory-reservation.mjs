/**
 * Proof: soft hold on place → release on cancel; confirm on payment (Inventory.reserved).
 *
 * Usage: npx tsx scripts/prove-inventory-reservation.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const {
    holdInventoryForOrder,
    confirmInventoryHoldForOrder,
    releaseInventoryHoldForOrder,
  } = await import("../src/server/inventory/reservation.ts");

  const marker = `resv-proof-${Date.now()}`;
  const product = await prisma.product.create({
    data: {
      sku: `${marker}-p`,
      slug: marker,
      name: "Reservation proof",
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
          stock: 2,
          price: 100,
        },
      },
    },
    include: { variants: true },
  });
  const variantId = product.variants[0].id;
  const lines = [{ variantId, quantity: 1, label: "proof" }];

  const warehouse =
    (await prisma.warehouse.findFirst({ where: { active: true } })) ??
    (await prisma.warehouse.create({
      data: { name: "Main Warehouse", code: `MAIN-${marker}`.slice(0, 32), isDefault: false, active: true },
    }));

  const inventory = await prisma.inventory.create({
    data: {
      warehouseId: warehouse.id,
      productId: product.id,
      variantId,
      quantity: 2,
      reserved: 0,
    },
  });

  const holdOrderId = `hold-${marker}`;
  const confirmOrderId = `confirm-${marker}`;

  // --- Soft hold ---
  await prisma.$transaction((tx) =>
    holdInventoryForOrder(tx, holdOrderId, lines, "proof@avyora"),
  );
  const afterHoldV = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
  const afterHoldI = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });

  // Second concurrent unit still available; third must fail (stock=2).
  const holdOrder2 = `hold2-${marker}`;
  await prisma.$transaction((tx) =>
    holdInventoryForOrder(tx, holdOrder2, lines, "proof2@avyora"),
  );
  let oversellRejected = false;
  try {
    await prisma.$transaction((tx) =>
      holdInventoryForOrder(tx, `hold3-${marker}`, lines, "proof3@avyora"),
    );
  } catch {
    oversellRejected = true;
  }

  // --- Release first hold ---
  await prisma.$transaction((tx) =>
    releaseInventoryHoldForOrder(tx, holdOrderId, lines, { actorEmail: "proof@avyora" }),
  );
  const afterReleaseI = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
  const afterReleaseV = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });

  // Release second hold, reset to qty=1 for confirm path
  await prisma.$transaction((tx) =>
    releaseInventoryHoldForOrder(tx, holdOrder2, lines, { actorEmail: "proof2@avyora" }),
  );
  await prisma.productVariant.update({ where: { id: variantId }, data: { stock: 1 } });
  await prisma.inventory.update({
    where: { id: inventory.id },
    data: { quantity: 1, reserved: 0 },
  });

  // --- Hold + confirm (payment) ---
  await prisma.$transaction(async (tx) => {
    await holdInventoryForOrder(tx, confirmOrderId, lines, "pay@avyora");
    await confirmInventoryHoldForOrder(tx, confirmOrderId, lines, "pay@avyora");
  });
  const afterConfirmI = await prisma.inventory.findUniqueOrThrow({ where: { id: inventory.id } });
  const afterConfirmV = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });

  // Cleanup
  await prisma.stockMovement.deleteMany({ where: { inventoryId: inventory.id } });
  await prisma.inventory.delete({ where: { id: inventory.id } });
  await prisma.productVariant.delete({ where: { id: variantId } });
  await prisma.product.delete({ where: { id: product.id } });

  const ok =
    afterHoldV.stock === 1 &&
    afterHoldI.quantity === 2 &&
    afterHoldI.reserved === 1 &&
    oversellRejected &&
    afterReleaseI.reserved === 1 && // second hold still active at release-of-first moment... 
    // Actually we release holdOrderId while holdOrder2 still active: reserved should be 1, quantity 2, stock 1
    afterReleaseV.stock === 1 &&
    afterConfirmI.quantity === 0 &&
    afterConfirmI.reserved === 0 &&
    afterConfirmV.stock === 0;

  // Re-evaluate release snapshot: after releasing first of two holds
  const releaseOk =
    afterReleaseI.quantity === 2 &&
    afterReleaseI.reserved === 1 &&
    afterReleaseV.stock === 1;

  console.log(
    JSON.stringify(
      {
        proof: "inventory_reservation",
        ok: Boolean(
          afterHoldV.stock === 1 &&
            afterHoldI.quantity === 2 &&
            afterHoldI.reserved === 1 &&
            oversellRejected &&
            releaseOk &&
            afterConfirmI.quantity === 0 &&
            afterConfirmI.reserved === 0 &&
            afterConfirmV.stock === 0,
        ),
        hold: {
          stock: afterHoldV.stock,
          quantity: afterHoldI.quantity,
          reserved: afterHoldI.reserved,
        },
        oversellRejected,
        afterFirstRelease: {
          stock: afterReleaseV.stock,
          quantity: afterReleaseI.quantity,
          reserved: afterReleaseI.reserved,
        },
        confirm: {
          stock: afterConfirmV.stock,
          quantity: afterConfirmI.quantity,
          reserved: afterConfirmI.reserved,
        },
      },
      null,
      2,
    ),
  );

  if (
    !(
      afterHoldV.stock === 1 &&
      afterHoldI.quantity === 2 &&
      afterHoldI.reserved === 1 &&
      oversellRejected &&
      releaseOk &&
      afterConfirmI.quantity === 0 &&
      afterConfirmI.reserved === 0 &&
      afterConfirmV.stock === 0
    )
  ) {
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify({ proof: "inventory_reservation", ok: false, error: String(error) }),
    );
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
