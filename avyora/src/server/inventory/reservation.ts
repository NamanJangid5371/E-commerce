import type { Prisma } from "@prisma/client";

export type StockLine = {
  variantId: string;
  quantity: number;
  /** For error messages */
  label?: string;
};

export class InsufficientStockError extends Error {
  readonly status = 409 as const;
  readonly available: number;
  readonly skuOrId: string;

  constructor(message: string, available: number, skuOrId: string) {
    super(message);
    this.name = "InsufficientStockError";
    this.available = available;
    this.skuOrId = skuOrId;
  }
}

/** Aggregate duplicate variant lines and sort ids for deadlock-safe locking. */
export function aggregateStockDemand(
  lines: StockLine[],
): Array<{ variantId: string; quantity: number; label?: string }> {
  const needed = new Map<string, { quantity: number; label?: string }>();
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    const prev = needed.get(line.variantId);
    needed.set(line.variantId, {
      quantity: (prev?.quantity ?? 0) + line.quantity,
      label: prev?.label ?? line.label,
    });
  }
  return [...needed.entries()]
    .map(([variantId, v]) => ({ variantId, quantity: v.quantity, label: v.label }))
    .sort((a, b) => a.variantId.localeCompare(b.variantId));
}

/** Soft hold created at checkout place. */
export function reserveReasonTag(orderId: string): string {
  return `order_reserved:${orderId}`;
}

/** Soft hold converted to sale after payment success (or COD at place). */
export function confirmReasonTag(orderId: string): string {
  return `order_confirmed:${orderId}`;
}

/** Soft hold released (customer cancel / generic). */
export function releaseReasonTag(orderId: string): string {
  return `order_release:${orderId}`;
}

type LockedVariant = {
  id: string;
  sku: string;
  stock: number;
  productId: string;
  product_name: string | null;
};

async function ensureDefaultWarehouse(tx: Prisma.TransactionClient) {
  let warehouse = await tx.warehouse.findFirst({
    where: { active: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  if (!warehouse) {
    warehouse = await tx.warehouse.create({
      data: { name: "Main Warehouse", code: "MAIN", isDefault: true, active: true },
    });
  }
  return warehouse;
}

async function ensureInventoryRow(
  tx: Prisma.TransactionClient,
  params: { variantId: string; productId: string; onHand: number },
) {
  const existing = await tx.inventory.findFirst({
    where: { variantId: params.variantId },
    orderBy: { id: "asc" },
  });
  if (existing) return existing;

  const warehouse = await ensureDefaultWarehouse(tx);
  return tx.inventory.create({
    data: {
      warehouseId: warehouse.id,
      productId: params.productId,
      variantId: params.variantId,
      quantity: Math.max(0, params.onHand),
      reserved: 0,
    },
  });
}

async function hasMovement(
  tx: Prisma.TransactionClient,
  reason: string,
): Promise<boolean> {
  const row = await tx.stockMovement.findFirst({
    where: { reason },
    select: { id: true },
  });
  return Boolean(row);
}

export async function inventoryHoldConfirmed(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<boolean> {
  return hasMovement(tx, confirmReasonTag(orderId));
}

export async function inventoryHoldReleased(
  tx: Prisma.TransactionClient,
  orderId: string,
  extraReasons: string[] = [],
): Promise<boolean> {
  const reasons = [
    releaseReasonTag(orderId),
    ...extraReasons,
  ];
  const row = await tx.stockMovement.findFirst({
    where: { reason: { in: reasons } },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Soft-hold sellable stock for an order inside an open transaction.
 * - ProductVariant.stock -= qty (storefront available)
 * - Inventory.reserved += qty
 * - Inventory.quantity unchanged (still on-hand)
 *
 * Idempotent per order via `order_reserved:{orderId}` movements.
 */
export async function holdInventoryForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  lines: StockLine[],
  actorEmail?: string | null,
): Promise<void> {
  const demand = aggregateStockDemand(lines);
  if (!demand.length) return;

  const reserveTag = reserveReasonTag(orderId);
  if (await hasMovement(tx, reserveTag)) return;

  for (const { variantId, quantity: qty, label: labelHint } of demand) {
    const locked = await tx.$queryRaw<LockedVariant[]>`
      SELECT
        pv.id,
        pv.sku,
        pv.stock,
        pv."productId" AS "productId",
        p.name AS product_name
      FROM product_variants pv
      LEFT JOIN products p ON p.id = pv."productId"
      WHERE pv.id = ${variantId}
      FOR UPDATE OF pv
    `;

    const row = locked[0];
    if (!row) {
      throw new InsufficientStockError(
        `Insufficient stock for ${labelHint ?? variantId}. Available: 0.`,
        0,
        variantId,
      );
    }

    const label = labelHint ?? `${row.product_name ?? "Item"} (${row.sku})`;

    // Ensure inventory exists, then lock it so reserved stays consistent.
    await ensureInventoryRow(tx, {
      variantId,
      productId: row.productId,
      onHand: row.stock,
    });

    const invLocked = await tx.$queryRaw<
      Array<{ id: string; quantity: number; reserved: number }>
    >`
      SELECT id, quantity, reserved
      FROM inventory
      WHERE "variantId" = ${variantId}
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE
    `;
    const inventory = invLocked[0];
    if (!inventory) {
      throw new InsufficientStockError(
        `Insufficient stock for ${label}. Available: 0.`,
        0,
        row.sku,
      );
    }

    const invAvailable = inventory.quantity - inventory.reserved;
    const available = Math.min(row.stock, invAvailable);
    if (available < qty) {
      throw new InsufficientStockError(
        `Insufficient stock for ${label}. Available: ${Math.max(0, available)}.`,
        Math.max(0, available),
        row.sku,
      );
    }

    const updated = await tx.productVariant.updateMany({
      where: { id: variantId, stock: { gte: qty } },
      data: { stock: { decrement: qty } },
    });
    if (updated.count !== 1) {
      throw new InsufficientStockError(
        `Insufficient stock for ${label}. Available: ${row.stock}.`,
        row.stock,
        row.sku,
      );
    }

    const reservedUpdate = await tx.inventory.updateMany({
      where: {
        id: inventory.id,
        reserved: inventory.reserved,
        quantity: { gte: inventory.reserved + qty },
      },
      data: { reserved: { increment: qty } },
    });
    if (reservedUpdate.count !== 1) {
      throw new InsufficientStockError(
        `Insufficient stock for ${label}. Available: ${Math.max(0, invAvailable)}.`,
        Math.max(0, invAvailable),
        row.sku,
      );
    }

    await tx.stockMovement.create({
      data: {
        inventoryId: inventory.id,
        delta: 0,
        reason: reserveTag,
        actorEmail: actorEmail ?? undefined,
      },
    });
  }
}

/**
 * Confirm a soft hold after payment: on-hand decreases, reserved clears.
 * ProductVariant.stock already reduced at hold time — left unchanged.
 * Idempotent via `order_confirmed:{orderId}`.
 */
export async function confirmInventoryHoldForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  lines: StockLine[],
  actorEmail?: string | null,
): Promise<void> {
  const demand = aggregateStockDemand(lines);
  if (!demand.length) return;

  const confirmTag = confirmReasonTag(orderId);
  if (await hasMovement(tx, confirmTag)) return;

  // Must have been reserved (or legacy unpaid path without tag — still confirm from lines).
  for (const { variantId, quantity: qty } of demand) {
    const invLocked = await tx.$queryRaw<
      Array<{ id: string; quantity: number; reserved: number }>
    >`
      SELECT id, quantity, reserved
      FROM inventory
      WHERE "variantId" = ${variantId}
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE
    `;
    const inventory = invLocked[0];
    if (!inventory) continue;

    const nextReserved = Math.max(0, inventory.reserved - qty);
    const nextQty = Math.max(0, inventory.quantity - qty);

    await tx.inventory.update({
      where: { id: inventory.id },
      data: { reserved: nextReserved, quantity: nextQty },
    });

    await tx.stockMovement.create({
      data: {
        inventoryId: inventory.id,
        delta: -qty,
        reason: confirmTag,
        actorEmail: actorEmail ?? undefined,
      },
    });
  }
}

/**
 * Release a soft hold (cancel / unpaid TTL) before payment confirmation.
 * Restores sellable stock; on-hand quantity unchanged.
 * Idempotent when `reasonTag` movement already exists (or generic release tag).
 */
export async function releaseInventoryHoldForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  lines: StockLine[],
  options?: {
    actorEmail?: string | null;
    /** Defaults to order_release:{orderId} */
    reasonTag?: string;
    /** Extra tags that also mean "already released" */
    alsoSkipIfReasons?: string[];
  },
): Promise<"released" | "skipped"> {
  const demand = aggregateStockDemand(lines);
  if (!demand.length) return "skipped";

  const reasonTag = options?.reasonTag ?? releaseReasonTag(orderId);
  const skipReasons = [
    reasonTag,
    releaseReasonTag(orderId),
    ...(options?.alsoSkipIfReasons ?? []),
  ];

  if (await inventoryHoldReleased(tx, orderId, skipReasons)) {
    return "skipped";
  }
  // Already sold — do not treat as soft-hold release.
  if (await inventoryHoldConfirmed(tx, orderId)) {
    return "skipped";
  }

  for (const { variantId, quantity: qty } of demand) {
    await tx.productVariant.update({
      where: { id: variantId },
      data: { stock: { increment: qty } },
    });

    const invLocked = await tx.$queryRaw<
      Array<{ id: string; reserved: number }>
    >`
      SELECT id, reserved
      FROM inventory
      WHERE "variantId" = ${variantId}
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE
    `;
    const inventory = invLocked[0];
    if (!inventory) continue;

    await tx.inventory.update({
      where: { id: inventory.id },
      data: { reserved: Math.max(0, inventory.reserved - qty) },
    });

    await tx.stockMovement.create({
      data: {
        inventoryId: inventory.id,
        delta: 0,
        reason: reasonTag,
        actorEmail: options?.actorEmail ?? undefined,
      },
    });
  }

  return "released";
}

/**
 * Restock after a confirmed sale is cancelled/returned.
 * Restores sellable + on-hand. Idempotent via reasonTag.
 */
export async function restockConfirmedInventoryForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  lines: StockLine[],
  options?: {
    actorEmail?: string | null;
    reasonTag?: string;
    alsoSkipIfReasons?: string[];
  },
): Promise<"restocked" | "skipped"> {
  const demand = aggregateStockDemand(lines);
  if (!demand.length) return "skipped";

  const reasonTag = options?.reasonTag ?? `order_cancel_restock:${orderId}`;
  const skipReasons = [reasonTag, ...(options?.alsoSkipIfReasons ?? [])];
  const prior = await tx.stockMovement.findFirst({
    where: { reason: { in: skipReasons } },
    select: { id: true },
  });
  if (prior) return "skipped";

  for (const { variantId, quantity: qty } of demand) {
    await tx.productVariant.update({
      where: { id: variantId },
      data: { stock: { increment: qty } },
    });

    const inventory = await tx.inventory.findFirst({
      where: { variantId },
      orderBy: { id: "asc" },
    });
    if (!inventory) continue;

    await tx.inventory.update({
      where: { id: inventory.id },
      data: { quantity: { increment: qty } },
    });

    await tx.stockMovement.create({
      data: {
        inventoryId: inventory.id,
        delta: qty,
        reason: reasonTag,
        actorEmail: options?.actorEmail ?? undefined,
      },
    });
  }

  return "restocked";
}

/**
 * After unpaid-TTL released a hold, a late payment must allocate stock again
 * (sellable + on-hand). Does not use reserved — hold was already cleared.
 * Also writes `order_confirmed:{orderId}` so cancel paths treat it as a confirmed sale.
 */
export async function allocateInventoryAfterTtlRelease(
  tx: Prisma.TransactionClient,
  orderId: string,
  lines: StockLine[],
  reasonTag: string,
  actorEmail?: string | null,
): Promise<void> {
  if (await hasMovement(tx, reasonTag)) return;

  const demand = aggregateStockDemand(lines);
  const confirmTag = confirmReasonTag(orderId);

  for (const { variantId, quantity: qty } of demand) {
    await tx.productVariant.update({
      where: { id: variantId },
      data: { stock: { decrement: qty } },
    });

    const inventory = await tx.inventory.findFirst({
      where: { variantId },
      orderBy: { id: "asc" },
    });
    if (!inventory) continue;

    await tx.inventory.update({
      where: { id: inventory.id },
      data: { quantity: { decrement: qty } },
    });

    await tx.stockMovement.create({
      data: {
        inventoryId: inventory.id,
        delta: -qty,
        reason: reasonTag,
        actorEmail: actorEmail ?? undefined,
      },
    });
  }

  // Sentinel so customer/logistics cancel uses confirmed-restock (not soft release).
  if (demand.length && !(await hasMovement(tx, confirmTag))) {
    const first = await tx.inventory.findFirst({
      where: { variantId: demand[0].variantId },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    if (first) {
      await tx.stockMovement.create({
        data: {
          inventoryId: first.id,
          delta: 0,
          reason: confirmTag,
          actorEmail: actorEmail ?? undefined,
        },
      });
    }
  }
}

/** Lines from order items for reservation helpers. */
export function stockLinesFromOrderItems(
  items: Array<{ variantId: string; quantity: number; name?: string | null; sku?: string | null }>,
): StockLine[] {
  return items.map((item) => ({
    variantId: item.variantId,
    quantity: item.quantity,
    label:
      item.name && item.sku
        ? `${item.name} (${item.sku})`
        : item.sku ?? item.variantId,
  }));
}
