export const STOREFRONT_ORIGIN = process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN ?? "http://localhost:3000";
export const ADMIN_ORIGIN = process.env.NEXT_PUBLIC_ADMIN_ORIGIN ?? "http://localhost:3001";
export const LOGISTICS_ORIGIN = process.env.NEXT_PUBLIC_LOGISTICS_ORIGIN ?? "http://localhost:3002";

export type CommercePayload = {
  catalog: unknown;
  collections: unknown;
  coupons: unknown;
  /** Omitted on purpose — Postgres is SoT; server ignores client lists. */
  customers?: unknown;
  orders?: unknown;
  campaigns: unknown;
  mediaUrls: unknown;
  audit: unknown;
  appointments?: unknown;
  ops: unknown;
};

export async function fetchCommerce() {
  const res = await fetch(`/api/commerce?t=${Date.now()}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to load commerce data");
  return res.json();
}

export async function putCommerce(payload: CommercePayload): Promise<{ updatedAt?: string }> {
  const res = await fetch("/api/commerce", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; updatedAt?: string };
  if (!res.ok) {
    throw new Error(data.error || `Failed to save commerce data (${res.status})`);
  }
  return { updatedAt: data.updatedAt };
}

const COOKIE = "avyora_admin";

/**
 * @deprecated Unsigned portal cookie — do NOT use for authorization.
 * Cleared on logout; never trusted by APIs.
 */
export function setAdminCookie(_user: { name: string; email: string }) {
  // Intentionally a no-op: privilege comes from HTTP-only avyora_access JWT only.
  clearAdminCookie();
}

export function clearAdminCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

/** @deprecated Prefer /api/auth/staff/me — unsigned cookie must not grant access. */
export function readAdminCookie(): { name: string; email: string } | null {
  return null;
}

export function isAdminHost() {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_AVYORA_APP === "admin" || process.env.AVYORA_APP === "admin";
  }
  if (process.env.NEXT_PUBLIC_AVYORA_APP === "admin") return true;
  return window.location.port === "3001" || window.location.origin === ADMIN_ORIGIN;
}

export function isLogisticsHost() {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_AVYORA_APP === "logistics" || process.env.AVYORA_APP === "logistics";
  }
  if (process.env.NEXT_PUBLIC_AVYORA_APP === "logistics") return true;
  return window.location.port === "3002" || window.location.origin === LOGISTICS_ORIGIN;
}
