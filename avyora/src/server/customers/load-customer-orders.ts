import { prisma } from "@/server/db";
import { mapPrismaCustomerToShop } from "@/server/customers/map-customer";
import { mapPrismaOrderToClient, orderDetailInclude } from "@/server/orders/map-order";
import type { Customer, Order } from "@/store/shop-types";

export type CustomerPurchaseSummary = {
  orderCount: number;
  itemCount: number;
  lifetimeSpend: number;
  paidOrderCount: number;
  lastOrderAt: string | null;
};

export type CustomerWithPurchaseHistory = {
  customer: Customer;
  orders: Order[];
  summary: CustomerPurchaseSummary;
};

function summarizeOrders(orders: Order[]): CustomerPurchaseSummary {
  const paid = orders.filter(
    (o) => o.paymentStatus === "Success" || o.status === "Delivered" || o.status === "Refunded",
  );
  const lifetimeSpend = orders
    .filter((o) => o.status !== "Cancelled" && o.paymentStatus !== "Cancelled")
    .reduce((sum, o) => sum + (o.total - (o.refundedAmount ?? 0)), 0);
  return {
    orderCount: orders.length,
    itemCount: orders.reduce((sum, o) => sum + o.items.reduce((n, i) => n + i.quantity, 0), 0),
    lifetimeSpend: Math.max(0, lifetimeSpend),
    paidOrderCount: paid.length,
    lastOrderAt: orders[0]?.createdAt ?? null,
  };
}

/**
 * Load one customer + full purchase history from Postgres.
 * Matches orders by customerId and by guestEmail (same email, guest checkouts).
 */
export async function loadCustomerWithPurchaseHistory(
  idOrEmail: string,
): Promise<CustomerWithPurchaseHistory | null> {
  const key = idOrEmail.trim();
  if (!key) return null;

  const row = await prisma.customer.findFirst({
    where: {
      deletedAt: null,
      OR: [
        { id: key },
        { user: { email: { equals: key, mode: "insensitive" } } },
      ],
    },
    include: {
      user: { select: { id: true, name: true, email: true, active: true, createdAt: true } },
      addresses: true,
    },
  });

  if (!row) return null;

  const customer = mapPrismaCustomerToShop(row);
  const email = customer.email.trim().toLowerCase();

  const orderRows = await prisma.order.findMany({
    where: {
      OR: [{ customerId: row.id }, { guestEmail: { equals: email, mode: "insensitive" } }],
    },
    include: orderDetailInclude,
    orderBy: { createdAt: "desc" },
  });

  const orders = orderRows.map(mapPrismaOrderToClient);
  return {
    customer,
    orders,
    summary: summarizeOrders(orders),
  };
}
