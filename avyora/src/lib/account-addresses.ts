import type { Address, Customer } from "@/store/shop-types";
import { useShopStore } from "@/store/shop-store";

function mergeAddressesIntoStore(addresses: Address[]) {
  const user = useShopStore.getState().user;
  if (!user || user.role !== "customer") return;
  const email = user.email.toLowerCase();
  const customers = useShopStore.getState().customers;
  const existing = customers.find((c) => c.email.toLowerCase() === email);
  const profile: Customer = existing
    ? { ...existing, addresses }
    : {
        id: user.id.startsWith("c-") ? user.id : `c-${email}`,
        name: user.name,
        email,
        createdAt: new Date().toISOString(),
        status: "active",
        addresses,
      };

  useShopStore.setState({
    customers: existing
      ? customers.map((c) => (c.email.toLowerCase() === email ? profile : c))
      : [profile, ...customers],
  });
}

function useCustomerAddressesSnapshot(): Address[] {
  const user = useShopStore.getState().user;
  if (!user || user.role !== "customer") return [];
  const customer = useShopStore.getState().customers.find((c) => c.email.toLowerCase() === user.email.toLowerCase());
  return customer?.addresses ?? [];
}

/** Load durable addresses from Postgres into the local customer profile. */
export async function hydrateAccountAddresses(): Promise<Address[]> {
  const local = useCustomerAddressesSnapshot();
  try {
    const res = await fetch("/api/account/addresses", {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return local;

    const payload = (await res.json()) as { ok?: boolean; data?: { addresses?: Address[] } };
    const addresses = Array.isArray(payload.data?.addresses) ? payload.data!.addresses! : [];

    // Never wipe a non-empty local profile with an empty remote response.
    if (!addresses.length) {
      if (local.length) return local;
      return [];
    }

    mergeAddressesIntoStore(addresses);
    return addresses;
  } catch {
    return local;
  }
}

/** Persist an address to Postgres and refresh local profile. */
export async function persistAccountAddress(address: Address): Promise<Address | null> {
  const hasServerId = Boolean(address.id && !address.id.startsWith("addr-"));
  try {
    const res = await fetch(hasServerId ? `/api/account/addresses/${address.id}` : "/api/account/addresses", {
      method: hasServerId ? "PATCH" : "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(address),
    });
    if (!res.ok) {
      useShopStore.getState().saveAddress(address);
      return address;
    }
    const payload = (await res.json()) as { ok?: boolean; data?: { address?: Address } };
    const saved = payload.data?.address;
    if (saved) {
      useShopStore.getState().saveAddress(saved);
      await hydrateAccountAddresses();
      return saved;
    }
  } catch {
    useShopStore.getState().saveAddress(address);
  }
  return address;
}

export async function deleteAccountAddress(addressId: string): Promise<void> {
  try {
    await fetch(`/api/account/addresses/${addressId}`, {
      method: "DELETE",
      credentials: "include",
    });
  } catch {
    /* local remove still applied below */
  }
  useShopStore.getState().removeAddress(addressId);
  await hydrateAccountAddresses();
}
