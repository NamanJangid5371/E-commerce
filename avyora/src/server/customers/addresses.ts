import { prisma } from "@/server/db";
import type { Address } from "@/store/shop-types";
import { mutateCommerce } from "@/server/commerce-db";

export type AddressInput = {
  name: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault?: boolean;
};

function normalizePincode(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

function mapRow(row: {
  id: string;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}): Address {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2 ?? undefined,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    isDefault: row.isDefault,
  };
}

function snapshotLooksLikeAddress(value: unknown): value is AddressInput {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return Boolean(
    String(raw.name || "").trim() &&
      String(raw.phone || "").trim() &&
      String(raw.line1 || "").trim() &&
      String(raw.city || "").trim() &&
      String(raw.state || "").trim() &&
      normalizePincode(String(raw.pincode || "")).length === 6,
  );
}

function sameAddress(a: AddressInput, b: { name: string; phone: string; line1: string; city: string; state: string; pincode: string }) {
  return (
    a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
    a.phone.replace(/\D/g, "") === b.phone.replace(/\D/g, "") &&
    a.line1.trim().toLowerCase() === b.line1.trim().toLowerCase() &&
    a.city.trim().toLowerCase() === b.city.trim().toLowerCase() &&
    a.state.trim().toLowerCase() === b.state.trim().toLowerCase() &&
    normalizePincode(a.pincode) === normalizePincode(b.pincode)
  );
}

/** Create or reuse a customer address; optionally mark default. */
export async function upsertCustomerAddress(
  customerId: string,
  input: AddressInput,
  options?: { makeDefault?: boolean; existingId?: string },
): Promise<Address> {
  const payload = {
    name: input.name.trim(),
    phone: input.phone.trim(),
    line1: input.line1.trim(),
    line2: input.line2?.trim() || null,
    city: input.city.trim(),
    state: input.state.trim(),
    pincode: normalizePincode(input.pincode),
  };

  const existingRows = await prisma.address.findMany({ where: { customerId } });
  const makeDefault =
    options?.makeDefault === true ||
    input.isDefault === true ||
    existingRows.length === 0 ||
    (options?.existingId
      ? Boolean(existingRows.find((r) => r.id === options.existingId)?.isDefault)
      : false);

  const match =
    (options?.existingId && existingRows.find((r) => r.id === options.existingId)) ||
    existingRows.find((r) => sameAddress(payload, r));

  const saved = await prisma.$transaction(async (tx) => {
    if (makeDefault) {
      await tx.address.updateMany({
        where: { customerId },
        data: { isDefault: false },
      });
    }

    if (match) {
      return tx.address.update({
        where: { id: match.id },
        data: {
          ...payload,
          isDefault: makeDefault || match.isDefault,
        },
      });
    }

    return tx.address.create({
      data: {
        customerId,
        ...payload,
        isDefault: makeDefault,
      },
    });
  });

  const mapped = mapRow(saved);
  mirrorAddressesToCommerce(customerId).catch(() => undefined);
  return mapped;
}

/** If the customer has orders but no saved addresses, seed from the latest order snapshot. */
export async function ensureCustomerAddresses(customerId: string): Promise<Address[]> {
  let rows = await prisma.address.findMany({
    where: { customerId },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });

  if (rows.length) return rows.map(mapRow);

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { user: { select: { email: true } } },
  });
  const email = customer?.user?.email?.trim().toLowerCase();

  const orders = await prisma.order.findMany({
    where: email
      ? { OR: [{ customerId }, { guestEmail: email }] }
      : { customerId },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { addressSnapshot: true },
  });

  for (const order of orders) {
    if (!snapshotLooksLikeAddress(order.addressSnapshot)) continue;
    await upsertCustomerAddress(customerId, order.addressSnapshot, { makeDefault: true });
    break;
  }

  rows = await prisma.address.findMany({
    where: { customerId },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  const mapped = rows.map(mapRow);
  if (mapped.length) {
    mirrorAddressesToCommerce(customerId).catch(() => undefined);
  }
  return mapped;
}

export async function syncCustomerAddressesToCommerce(customerId: string) {
  await mirrorAddressesToCommerce(customerId);
}

async function mirrorAddressesToCommerce(customerId: string) {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        user: { select: { email: true } },
        addresses: { orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] },
      },
    });
    if (!customer?.user?.email) return;

    const email = customer.user.email.trim().toLowerCase();
    const addresses = customer.addresses.map(mapRow);
    await mutateCommerce((commerce) => {
      const idx = commerce.customers.findIndex((c) => c.email.toLowerCase() === email);
      if (idx < 0) return;
      const customers = [...commerce.customers];
      customers[idx] = {
        ...customers[idx],
        addresses,
      };
      return { ...commerce, customers };
    });
  } catch {
    /* best-effort mirror */
  }
}
