import type { Prisma } from "@prisma/client";
import {
  confirmInventoryHoldForOrder,
  holdInventoryForOrder,
  type StockLine,
} from "@/server/inventory/reservation";

export {
  aggregateStockDemand,
  InsufficientStockError,
  type StockLine,
} from "@/server/inventory/reservation";

/**
 * Soft-hold stock for checkout inside an existing Prisma transaction.
 * Requires `orderId` so holds are tagged and can be confirmed/released.
 *
 * When `confirmImmediately` is true (COD), converts the hold to a sale in the same tx.
 */
export async function reserveStockInTransaction(
  tx: Prisma.TransactionClient,
  lines: StockLine[],
  actorEmail?: string | null,
  options?: {
    orderId: string;
    /** COD / already-paid at place — confirm hold in the same transaction */
    confirmImmediately?: boolean;
  },
): Promise<void> {
  if (!options?.orderId) {
    throw new Error("reserveStockInTransaction requires options.orderId for inventory reservation");
  }

  await holdInventoryForOrder(tx, options.orderId, lines, actorEmail);

  if (options.confirmImmediately) {
    await confirmInventoryHoldForOrder(tx, options.orderId, lines, actorEmail);
  }
}
