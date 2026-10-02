/**
 * Storefront customer auth helpers.
 * Identity must follow the JWT cookie — not a stale Zustand user from another account.
 */

import { clearAdminCookie } from "@/lib/host";
import { useShopStore } from "@/store/shop-store";
import type { Customer, User } from "@/store/shop-types";

export type CustomerAuthPayload = {
  user: { id: string; name: string; email: string };
  customer?: { id: string; groupId?: string | null; emailVerified?: boolean };
};

/** Apply a verified customer session into the shop store (upserts local profile). */
export function applyCustomerSession(payload: CustomerAuthPayload, options?: { resetBrowserBag?: boolean }) {
  const email = payload.user.email.trim().toLowerCase();
  const name = payload.user.name?.trim() || email.split("@")[0] || "Customer";
  const customerId = payload.customer?.id?.trim() || payload.user.id;
  const prev = useShopStore.getState().user;
  const switching =
    Boolean(prev?.email) && prev!.email.toLowerCase() !== email;

  const customers = useShopStore.getState().customers;
  const existing = customers.find((c) => c.email.toLowerCase() === email);
  const profile: Customer = existing
    ? {
        ...existing,
        id: customerId,
        name,
        email,
        groupId: payload.customer?.groupId ?? existing.groupId,
        status: existing.status === "blocked" ? "blocked" : "active",
        emailVerified:
          payload.customer?.emailVerified !== undefined
            ? payload.customer.emailVerified
            : existing.emailVerified,
      }
    : {
        id: customerId,
        name,
        email,
        createdAt: new Date().toISOString(),
        status: "active",
        groupId: payload.customer?.groupId ?? "g-regular",
        addresses: [],
        emailVerified: payload.customer?.emailVerified ?? false,
        notifications: { orders: true, marketing: false, security: true },
      };

  const nextCustomers = existing
    ? customers.map((c) => (c.email.toLowerCase() === email ? profile : c))
    : [profile, ...customers];

  const user: User = {
    id: customerId,
    name,
    email,
    role: "customer",
  };

  useShopStore.setState({
    user,
    customers: nextCustomers,
    ...(switching || options?.resetBrowserBag
      ? {
          wishlist: [],
          couponCode: "",
        }
      : {}),
  });

  clearAdminCookie();
  return user;
}

/** Clear local customer UI session (does not call the network). */
export function clearCustomerLocalSession() {
  clearAdminCookie();
  useShopStore.setState({ user: null });
}

/** Sign out: revoke server cookies, then clear local identity. */
export async function logoutCustomer(): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    /* still clear local state */
  }
  clearAdminCookie();
  useShopStore.getState().logout();
}

/**
 * Restore storefront identity from JWT.
 * If the cookie is a different customer than Zustand, trust the cookie.
 * If cookie is missing (401), clear a stale customer so another account can sign in.
 */
export async function restoreCustomerSessionFromJwt(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/me", {
      credentials: "include",
      cache: "no-store",
    });

    if (res.status === 401 || res.status === 403) {
      const current = useShopStore.getState().user;
      if (current?.role === "customer") {
        clearCustomerLocalSession();
      }
      return false;
    }

    if (!res.ok) {
      // Transient network/db — keep existing local session.
      return Boolean(useShopStore.getState().user?.role === "customer");
    }

    const body = (await res.json()) as {
      ok?: boolean;
      data?: CustomerAuthPayload;
    };
    if (!body.ok || !body.data?.user?.email) return false;

    applyCustomerSession(body.data);
    return true;
  } catch {
    return Boolean(useShopStore.getState().user?.role === "customer");
  }
}
