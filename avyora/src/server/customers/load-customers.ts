import { prisma } from "@/server/db";
import { mapPrismaCustomerToShop, mergeCustomerLists } from "@/server/customers/map-customer";
import type { Customer } from "@/store/shop-types";
import type { CommerceSnapshot } from "@/server/commerce-db";

/**
 * Staff customer list — Postgres is source of truth.
 * `commerceCustomers` is offline fallback only when Prisma fails.
 */
export async function loadCustomersForStaff(
  commerceCustomers: Customer[] = [],
  options?: { take?: number },
): Promise<Customer[]> {
  const take = Math.min(2000, Math.max(1, options?.take ?? 100));
  try {
    const rows = await prisma.customer.findMany({
      where: { deletedAt: null },
      include: {
        user: { select: { id: true, name: true, email: true, active: true, createdAt: true } },
        addresses: true,
      },
      orderBy: { createdAt: "desc" },
      take,
    });
    return rows.map(mapPrismaCustomerToShop);
  } catch {
    return commerceCustomers.slice(0, take);
  }
}

export async function withStaffCustomers(snapshot: CommerceSnapshot): Promise<CommerceSnapshot> {
  const customers = await loadCustomersForStaff(snapshot.customers ?? []);
  return { ...snapshot, customers };
}

/** Keep commerce.json in sync when a customer registers in Postgres. */
export async function mirrorCustomerToCommerce(input: {
  id: string;
  name: string;
  email: string;
  phone?: string;
  groupId?: string | null;
  createdAt?: Date;
}) {
  try {
    const { mutateCommerce } = await import("@/server/commerce-db");
    const email = input.email.trim().toLowerCase();
    await mutateCommerce((commerce) => {
      const existing = commerce.customers.findIndex((c) => c.email.toLowerCase() === email);
      const next: Customer = {
        id: input.id,
        name: input.name.trim(),
        email,
        phone: input.phone,
        createdAt: (input.createdAt ?? new Date()).toISOString(),
        status: "active",
        groupId: input.groupId ?? "g-regular",
        addresses: [],
        emailVerified: false,
      };
      const customers = [...commerce.customers];
      if (existing >= 0) {
        customers[existing] = {
          ...customers[existing],
          ...next,
          emailVerified: customers[existing].emailVerified || next.emailVerified,
          password: customers[existing].password,
          addresses: customers[existing].addresses,
        };
      } else {
        customers.push(next);
      }
      return { ...commerce, customers };
    });
  } catch {
    /* mirror is best-effort */
  }
}

export { mergeCustomerLists };
