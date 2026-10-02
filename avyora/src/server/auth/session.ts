import { SignJWT, jwtVerify } from "jose";
import type { NextResponse } from "next/server";
import { isWeakJwtSecret } from "@/server/security/runtime-config";

/** Customer (storefront) session cookies */
export const ACCESS_COOKIE = "avyora_access";
export const REFRESH_COOKIE = "avyora_refresh";

/** Staff (admin / logistics) session cookies — separate so storefront login cannot wipe admin */
export const STAFF_ACCESS_COOKIE = "avyora_staff_access";
export const STAFF_REFRESH_COOKIE = "avyora_staff_refresh";

export type AuthCookieAudience = "customer" | "staff";

/** Access JWT lifetime — long enough that middleware doesn't kick staff every few minutes. */
export const ACCESS_TTL = "2h";
export const REFRESH_TTL = "7d";

function requireSecret(name: "JWT_SECRET" | "JWT_REFRESH_SECRET"): string {
  const value = process.env[name]?.trim();
  if (isWeakJwtSecret(value)) {
    throw new Error(
      `${name} must be a strong unique secret (32+ chars). Placeholders like change-me / dev-only-change-me are not allowed.`,
    );
  }
  return value!;
}

function accessKey() {
  return new TextEncoder().encode(requireSecret("JWT_SECRET"));
}

function refreshKey() {
  return new TextEncoder().encode(requireSecret("JWT_REFRESH_SECRET"));
}

export type AccessTokenPayload = {
  userId: string;
  email: string;
  role: string;
  permissions: string[];
};

export type RefreshTokenPayload = {
  userId: string;
};

function accessExpiresAt() {
  return new Date(Date.now() + 2 * 60 * 60 * 1000);
}

function refreshExpiresAt() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

function hostnameOf(originOrHost: string): string | null {
  const raw = originOrHost.trim();
  if (!raw) return null;
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Longest shared parent domain across hosts (e.g. store.a.com + admin.a.com → a.com).
 * Returns null for localhost / identical hosts / too-short public suffixes.
 */
function sharedParentDomain(hosts: string[]): string | null {
  const unique = [...new Set(hosts.map((h) => h.toLowerCase()).filter(Boolean))];
  if (unique.length < 2) return null;
  if (unique.every((h) => h === unique[0])) return null;
  if (unique.some((h) => h === "localhost" || !h.includes("."))) return null;

  const parts = unique.map((h) => h.split(".").filter(Boolean));
  let common = parts[0] ?? [];
  for (const labels of parts.slice(1)) {
    const next: string[] = [];
    const max = Math.min(common.length, labels.length);
    for (let i = 1; i <= max; i++) {
      if (common[common.length - i] === labels[labels.length - i]) {
        next.unshift(common[common.length - i]!);
      } else {
        break;
      }
    }
    common = next;
  }

  // Require at least two labels (example.com) — never Domain=.com
  if (common.length < 2) return null;
  return common.join(".");
}

/**
 * Cookie Domain for cross-subdomain staff/customer sessions.
 * Prefer AUTH_COOKIE_DOMAIN; otherwise derive from public portal origins when they share a parent.
 * Omit on localhost (host-only cookies already cover all ports).
 */
export function resolveAuthCookieDomain(): string | undefined {
  const explicit = (process.env.AUTH_COOKIE_DOMAIN || process.env.COOKIE_DOMAIN || "").trim();
  if (explicit) {
    const host = hostnameOf(explicit.replace(/^\./, ""));
    if (!host || host === "localhost") return undefined;
    return host;
  }

  const hosts = [
    process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN,
    process.env.NEXT_PUBLIC_ADMIN_ORIGIN,
    process.env.NEXT_PUBLIC_LOGISTICS_ORIGIN,
  ]
    .map((origin) => (origin ? hostnameOf(origin) : null))
    .filter((h): h is string => Boolean(h));

  return sharedParentDomain(hosts) ?? undefined;
}

function authCookiesSecure(): boolean {
  const flag = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  if (process.env.NODE_ENV === "production") return true;
  const origins = [
    process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN,
    process.env.NEXT_PUBLIC_ADMIN_ORIGIN,
    process.env.NEXT_PUBLIC_LOGISTICS_ORIGIN,
  ];
  return origins.some((o) => o?.startsWith("https://"));
}

function cookieBase() {
  const domain = resolveAuthCookieDomain();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: authCookiesSecure(),
    ...(domain ? { domain } : {}),
  };
}

function cookieNames(audience: AuthCookieAudience) {
  return audience === "staff"
    ? { access: STAFF_ACCESS_COOKIE, refresh: STAFF_REFRESH_COOKIE }
    : { access: ACCESS_COOKIE, refresh: REFRESH_COOKIE };
}

export async function createAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({
    email: payload.email,
    role: payload.role,
    permissions: payload.permissions,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(accessKey());
}

export async function createRefreshToken(payload: RefreshTokenPayload): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(REFRESH_TTL)
    .sign(refreshKey());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, accessKey());
  const userId = payload.sub;
  if (!userId || typeof userId !== "string") {
    throw new Error("Invalid access token subject");
  }

  return {
    userId,
    email: String(payload.email ?? ""),
    role: String(payload.role ?? "CUSTOMER"),
    permissions: Array.isArray(payload.permissions)
      ? payload.permissions.map(String)
      : [],
  };
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, refreshKey());
  const userId = payload.sub;
  if (!userId || typeof userId !== "string") {
    throw new Error("Invalid refresh token subject");
  }

  return { userId };
}

export function setAuthCookies(
  response: NextResponse,
  access: string,
  refresh: string,
  audience: AuthCookieAudience = "customer",
) {
  const base = cookieBase();
  const names = cookieNames(audience);
  response.cookies.set(names.access, access, {
    ...base,
    expires: accessExpiresAt(),
  });
  response.cookies.set(names.refresh, refresh, {
    ...base,
    expires: refreshExpiresAt(),
  });
}

export function clearAuthCookies(
  response: NextResponse,
  audience: AuthCookieAudience | "all" = "all",
) {
  const base = cookieBase();
  const targets: AuthCookieAudience[] =
    audience === "all" ? ["customer", "staff"] : [audience];

  for (const kind of targets) {
    const names = cookieNames(kind);
    response.cookies.set(names.access, "", {
      ...base,
      expires: new Date(0),
    });
    response.cookies.set(names.refresh, "", {
      ...base,
      expires: new Date(0),
    });
  }
}
