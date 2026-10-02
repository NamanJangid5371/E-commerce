/**
 * Staff authentication helpers — JWT via HTTP-only cookies
 * (avyora_staff_access / avyora_staff_refresh).
 * Never stores passwords or tokens in localStorage.
 */

import { clearAdminCookie } from "@/lib/host";
import { useShopStore } from "@/store/shop-store";

export type StaffSessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type StaffMe = {
  userId: string;
  email: string;
  role: string;
  permissions: string[];
  isAdmin: boolean;
};

type ApiErrorBody = {
  ok?: boolean;
  error?: string | { message?: string; code?: string };
  data?: unknown;
};

/** Single-flight: concurrent refresh calls share one rotation (avoids invalidating the new token). */
let refreshInFlight: Promise<boolean> | null = null;
let ensureInFlight: Promise<StaffMe | null> | null = null;

function errorMessage(data: ApiErrorBody, fallback: string): string {
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error === "object" && data.error.message) {
    return data.error.message;
  }
  return fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function fetchStaffMe(): Promise<StaffMe | null> {
  const res = await fetch("/api/auth/staff/me", {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as { ok?: boolean; data?: StaffMe };
  if (!payload.ok || !payload.data?.isAdmin) return null;
  return payload.data;
}

/** Rotate access JWT using the refresh cookie. */
export async function refreshStaffSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Verify JWT; if access expired, try refresh.
 * Retries briefly so a single network blip / refresh race does not force sign-out.
 */
export async function ensureStaffSession(): Promise<StaffMe | null> {
  if (ensureInFlight) return ensureInFlight;
  ensureInFlight = (async () => {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await fetchStaffMe();
        if (current) return current;

        const refreshed = await refreshStaffSession();
        if (refreshed) {
          const after = await fetchStaffMe();
          if (after) return after;
        }

        if (attempt < 2) await sleep(250 * (attempt + 1));
      }
      return null;
    } catch {
      return null;
    } finally {
      ensureInFlight = null;
    }
  })();
  return ensureInFlight;
}

export async function loginStaff(
  email: string,
  password: string,
): Promise<
  | { ok: true; user: StaffSessionUser; permissions: string[]; role: string }
  | { ok: false; error: string; status: number }
> {
  try {
    const res = await fetch("/api/auth/staff/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });

    const data = (await res.json()) as ApiErrorBody & {
      data?: {
        user: StaffSessionUser;
        permissions?: string[];
        role?: string;
      };
    };

    if (!res.ok || !data.ok || !data.data?.user) {
      return {
        ok: false,
        error: errorMessage(data, "Incorrect staff email or password."),
        status: res.status,
      };
    }

    // Confirm HTTP-only JWT cookie is readable by the server before navigating.
    const me = await fetchStaffMe();
    if (!me) {
      return {
        ok: false,
        error: "Signed in, but session cookie was not set. Check that cookies are enabled.",
        status: 500,
      };
    }

    useShopStore.getState().setStaffSession({
      id: data.data.user.id,
      name: data.data.user.name,
      email: data.data.user.email,
    });

    return {
      ok: true,
      user: data.data.user,
      permissions: data.data.permissions ?? me.permissions,
      role: data.data.role ?? me.role,
    };
  } catch {
    return {
      ok: false,
      error: "Staff sign-in requires the server. Check your connection and try again.",
      status: 0,
    };
  }
}

/** Clear staff JWT cookies server-side and wipe local staff UI state. */
export async function logoutStaff(): Promise<void> {
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
