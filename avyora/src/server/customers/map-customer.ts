import type { Address, Customer } from "@/store/shop-types";
import type { Address as PrismaAddress, Customer as PrismaCustomer, User } from "@prisma/client";

type PrismaCustomerRow = PrismaCustomer & {
  user: Pick<User, "id" | "name" | "email" | "active" | "createdAt">;
  addresses?: PrismaAddress[];
};

export function mapPrismaCustomerToShop(row: PrismaCustomerRow): Customer {
  const addresses: Address[] = (row.addresses ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2 ?? undefined,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    isDefault: a.isDefault,
  }));

  return {
    id: row.id,
    name: row.user.name,
    email: row.user.email,
    phone: row.phone ?? undefined,
    createdAt: row.createdAt.toISOString(),
    status: row.status === "BLOCKED" || !row.user.active ? "blocked" : "active",
    notes: row.notes ?? undefined,
    groupId: row.groupId ?? undefined,
    addresses,
    emailVerified: row.emailVerified,
    phoneVerified: row.phoneVerified,
    preferredRingSize: row.preferredRingSize ?? undefined,
  };
}

/** Prisma customers win by email; keep commerce-only accounts that are not in Postgres.
 *  When Prisma has no addresses yet, keep commerce addresses so the profile is not blank.
 */
export function mergeCustomerLists(prismaCustomers: Customer[], commerceCustomers: Customer[]): Customer[] {
  const byEmail = new Map<string, Customer>();
  for (const c of prismaCustomers) {
    byEmail.set(c.email.trim().toLowerCase(), c);
  }
  for (const c of commerceCustomers) {
    const key = c.email.trim().toLowerCase();
    const existing = byEmail.get(key);
    if (!existing) {
      byEmail.set(key, c);
      continue;
    }
    if (!(existing.addresses?.length) && c.addresses?.length) {
      byEmail.set(key, { ...existing, addresses: c.addresses });
    }
  }
  return [...byEmail.values()].sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
  );
}
