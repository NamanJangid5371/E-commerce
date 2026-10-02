import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const ADMIN_ORIGIN = process.env.NEXT_PUBLIC_ADMIN_ORIGIN ?? "http://localhost:3001";
const STOREFRONT_ORIGIN = process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN ?? "http://localhost:3000";
const LOGISTICS_ORIGIN = process.env.NEXT_PUBLIC_LOGISTICS_ORIGIN ?? "http://localhost:3002";
const ACCESS_COOKIE = "avyora_access";
const STAFF_ACCESS_COOKIE = "avyora_staff_access";
const STAFF_REFRESH_COOKIE = "avyora_staff_refresh";
const REFRESH_COOKIE = "avyora_refresh";

type Portal = "store" | "admin" | "logistics";

function accessKey(): Uint8Array | null {
  const value = process.env.JWT_SECRET?.trim() ?? "";
  // Never verify with a hardcoded fallback — missing/placeholder secrets = unauthenticated.
  if (
    !value ||
    value.length < 32 ||
    value === "dev-only-change-me" ||
    /change-me/i.test(value)
  ) {
    return null;
  }
  return new TextEncoder().encode(value);
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Prefer X-Forwarded-Host behind reverse proxies (HTTPS terminates upstream). */
function requestHostname(request: NextRequest): string {
  const raw =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    "";
  if (!raw) return "";
  try {
    return new URL(`http://${raw}`).hostname.toLowerCase();
  } catch {
    return raw.split(":")[0]?.toLowerCase() ?? "";
  }
}

/**
 * Resolve which portal this process/request belongs to.
 * Order: AVYORA_APP (Docker/build) → distinct origin hostnames → local ports.
 * Port alone is insufficient behind HTTPS (empty/443).
 */
function resolvePortal(request: NextRequest): Portal {
  const fromEnv = (process.env.AVYORA_APP || process.env.NEXT_PUBLIC_AVYORA_APP || "")
    .trim()
    .toLowerCase();
  if (fromEnv === "admin" || fromEnv === "logistics" || fromEnv === "store") {
    return fromEnv;
  }

  const host = requestHostname(request);
  const adminHost = hostnameOf(ADMIN_ORIGIN);
  const logisticsHost = hostnameOf(LOGISTICS_ORIGIN);
  const storeHost = hostnameOf(STOREFRONT_ORIGIN);

  if (host && adminHost && host === adminHost && adminHost !== storeHost) return "admin";
  if (host && logisticsHost && host === logisticsHost && logisticsHost !== storeHost) {
    return "logistics";
  }
  if (host && storeHost && host === storeHost && storeHost !== adminHost && storeHost !== logisticsHost) {
    return "store";
  }

  const port = request.nextUrl.port;
  if (port === "3001") return "admin";
  if (port === "3002") return "logistics";
  if (port === "3000") return "store";

  return "store";
}

async function staffSessionFromRequest(request: NextRequest): Promise<{
  role: string;
} | null> {
  const key = accessKey();
  if (!key) return null;

  const candidates = [
    request.cookies.get(STAFF_ACCESS_COOKIE)?.value,
    // Legacy fallback while browsers still hold the old shared cookie from before the split.
    request.cookies.get(ACCESS_COOKIE)?.value,
  ].filter(Boolean) as string[];

  for (const token of candidates) {
    try {
      const { payload } = await jwtVerify(token, key);
      const role = String(payload.role ?? "");
      if (role === "ADMIN") return { role };
    } catch {
      /* try next */
    }
  }
  return null;
}

function hasStaffRefreshCookie(request: NextRequest): boolean {
  return Boolean(
    request.cookies.get(STAFF_REFRESH_COOKIE)?.value ||
      request.cookies.get(REFRESH_COOKIE)?.value,
  );
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/products") ||
    pathname.startsWith("/brand") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.png" ||
    pathname === "/apple-icon.png"
  ) {
    return NextResponse.next();
  }

  const portal = resolvePortal(request);

  // Storefront: send /admin and staff login to the admin host
  if (portal === "store") {
    if (pathname.startsWith("/admin")) {
      return NextResponse.redirect(`${ADMIN_ORIGIN}${pathname}${search}`);
    }
    if (pathname === "/staff-login" || pathname.startsWith("/staff-login/")) {
      return NextResponse.redirect(`${ADMIN_ORIGIN}/staff-login${search}`);
    }
    if (pathname.startsWith("/logistics")) {
      return NextResponse.redirect(`${LOGISTICS_ORIGIN}${pathname}${search}`);
    }
    if (pathname === "/logistics-login" || pathname.startsWith("/logistics-login/")) {
      return NextResponse.redirect(`${LOGISTICS_ORIGIN}/logistics-login${search}`);
    }
  }

  // Admin host: staff login only — never the customer login UI
  if (portal === "admin") {
    if (pathname === "/login" || pathname.startsWith("/login/")) {
      return NextResponse.redirect(new URL(`/staff-login${search}`, request.url));
    }
    if (pathname === "/staff-login" || pathname.startsWith("/staff-login/")) {
      return NextResponse.next();
    }
    if (!pathname.startsWith("/admin")) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    // Gate /admin/* behind verified staff JWT.
    // If access expired but refresh cookie remains, let the page load so the client can refresh.
    const session = await staffSessionFromRequest(request);
    if (session?.role === "ADMIN") {
      return NextResponse.next();
    }
    if (hasStaffRefreshCookie(request)) {
      return NextResponse.next();
    }
    return NextResponse.redirect(
      new URL(`/staff-login?next=${encodeURIComponent(pathname)}`, request.url),
    );
  }

  if (portal === "logistics") {
    if (pathname === "/login" || pathname.startsWith("/login/")) {
      return NextResponse.redirect(new URL(`/logistics-login${search}`, request.url));
    }
    if (pathname === "/staff-login" || pathname.startsWith("/staff-login/")) {
      return NextResponse.redirect(new URL(`/logistics-login${search}`, request.url));
    }
    if (pathname === "/logistics-login" || pathname.startsWith("/logistics-login/")) {
      return NextResponse.next();
    }
    if (!pathname.startsWith("/logistics")) {
      return NextResponse.redirect(new URL("/logistics", request.url));
    }
    const session = await staffSessionFromRequest(request);
    if (session?.role === "ADMIN") {
      return NextResponse.next();
    }
    if (hasStaffRefreshCookie(request)) {
      return NextResponse.next();
    }
    return NextResponse.redirect(
      new URL(`/logistics-login?next=${encodeURIComponent(pathname)}`, request.url),
    );
  }

  return NextResponse.next();
}

export const config = {
  // Skip APIs and static assets — portal gates are HTML-only; APIs enforce JWT themselves.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|.*\\.(?:jpg|jpeg|png|ico|webp|svg)$).*)",
  ],
};
