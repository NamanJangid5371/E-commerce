import { prisma } from "@/server/db";
import { mapPrismaOrderToClient, orderDetailInclude } from "@/server/orders/map-order";
import type { Order } from "@/store/shop-types";
import type { CommerceSnapshot } from "@/server/commerce-db";

function orderKey(order: Order) {
  return order.id.trim().toLowerCase();
}

/**
 * @deprecated Prefer Prisma-only lists. Kept for tests / emergency offline merge.
 * Prisma orders win by id; commerce-only rows are retained only when explicitly requested.
 */
export function mergeOrderLists(prismaOrders: Order[], commerceOrders: Order[]): Order[] {
  const byId = new Map<string, Order>();
  for (const o of prismaOrders) byId.set(orderKey(o), o);
  for (const o of commerceOrders) {
    const key = orderKey(o);
    if (!byId.has(key)) byId.set(key, o);
  }
  return [...byId.values()].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

/**
 * Staff order list — Postgres is source of truth.
 * `commerceOrders` is used only when Prisma is unavailable (offline fallback).
 * Callers should paginate; `take` caps the DB fetch (default 100, hard max 2000).
 */
export async function loadOrdersForStaff(
  commerceOrders: Order[] = [],
  options?: { take?: number },
): Promise<Order[]> {
  const take = Math.min(2000, Math.max(1, options?.take ?? 100));
  try {
    const rows = await prisma.order.findMany({
      include: orderDetailInclude,
      orderBy: { createdAt: "desc" },
      take,
    });
    return rows.map(mapPrismaOrderToClient);
  } catch {
    return commerceOrders.slice(0, take);
  }
}

/** Resolve one order for logistics/admin: Prisma first. */
export async function loadOrderByNumber(orderNumber: string): Promise<Order | null> {
  try {
    const row = await prisma.order.findFirst({
      where: {
        OR: [{ orderNumber }, { legacyId: orderNumber }, { id: orderNumber }],
      },
      include: orderDetailInclude,
    });
    if (row) return mapPrismaOrderToClient(row);
  } catch {
    /* fall through */
  }
  return null;
}

export async function withStaffOrders(snapshot: CommerceSnapshot): Promise<CommerceSnapshot> {
  const orders = await loadOrdersForStaff(snapshot.orders ?? []);
  return { ...snapshot, orders };
}
