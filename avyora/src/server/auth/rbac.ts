import { prisma } from "@/server/db";
import { hasPermission } from "@/server/auth/permissions";
import {
  ACCESS_COOKIE,
  STAFF_ACCESS_COOKIE,
  verifyAccessToken,
  type AccessTokenPayload,
} from "@/server/auth/session";

export type AuthContext = {
  userId: string;
  email: string;
  role: string;
  permissions: string[];
  isAdmin: boolean;
};

export class AuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

function readNamedCookie(request: Request, cookieName: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === cookieName) {
      const value = rest.join("=");
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

/** True when the request is aimed at admin/logistics portals (prefer staff JWT). */
export function isStaffPortalRequest(request: Request): boolean {
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    "";
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  const port = host.includes(":") ? host.split(":").pop() : "";

  if (port === "3001" || port === "3002") return true;

  const adminHost = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_ADMIN_ORIGIN ?? "http://localhost:3001").hostname.toLowerCase();
    } catch {
      return "localhost";
    }
  })();
  const logisticsHost = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_LOGISTICS_ORIGIN ?? "http://localhost:3002").hostname.toLowerCase();
    } catch {
      return "localhost";
    }
  })();
  const storeHost = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN ?? "http://localhost:3000").hostname.toLowerCase();
    } catch {
      return "localhost";
    }
  })();

  if (hostname && hostname === adminHost && adminHost !== storeHost) return true;
  if (hostname && hostname === logisticsHost && logisticsHost !== storeHost) return true;

  const app = (process.env.AVYORA_APP || process.env.NEXT_PUBLIC_AVYORA_APP || "").toLowerCase();
  return app === "admin" || app === "logistics";
}

async function loadAdminPermissions(userId: string): Promise<string[]> {
  const adminUser = await prisma.adminUser.findUnique({
    where: { userId },
    include: {
      role: {
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      },
    },
  });

  if (!adminUser) {
    return [];
  }

  if (adminUser.role.name === "SUPER_ADMIN") {
    return ["*"];
  }

  return adminUser.role.permissions.map((entry) => entry.permission.code);
}

async function buildAuthContext(payload: AccessTokenPayload): Promise<AuthContext> {
  const isAdmin = payload.role === "ADMIN";

  let permissions = payload.permissions;
  if (isAdmin) {
    permissions = await loadAdminPermissions(payload.userId);
  }

  return {
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    permissions,
    isAdmin,
  };
}

async function tryAccessToken(token: string | null): Promise<AuthContext | null> {
  if (!token) return null;
  try {
    const payload = await verifyAccessToken(token);
    return buildAuthContext(payload);
  } catch {
    return null;
  }
}

export async function getSessionFromRequest(request: Request): Promise<AuthContext | null> {
  const bearer = extractBearerToken(request);
  if (bearer) {
    return tryAccessToken(bearer);
  }

  const staffToken = readNamedCookie(request, STAFF_ACCESS_COOKIE);
  const customerToken = readNamedCookie(request, ACCESS_COOKIE);

  if (isStaffPortalRequest(request)) {
    // Prefer dedicated staff cookie; fall back to legacy shared access cookie.
    return (await tryAccessToken(staffToken)) ?? (await tryAccessToken(customerToken));
  }

  // Storefront: never treat a staff JWT as the customer session.
  const customer = await tryAccessToken(customerToken);
  if (customer && !customer.isAdmin) return customer;
  return null;
}

export async function requireAuth(request: Request): Promise<AuthContext | null> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return null;
  }
  return session;
}

export async function requireStaff(request: Request): Promise<AuthContext> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    throw new AuthError("Authentication required", 401);
  }
  if (!session.isAdmin) {
    throw new AuthError("Staff access required", 403);
  }
  return session;
}

export async function requirePermission(
  request: Request,
  permission: string,
): Promise<AuthContext> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    throw new AuthError("Authentication required", 401);
  }

  if (!hasPermission(session.permissions, permission)) {
    throw new AuthError("Insufficient permissions", 403);
  }

  return session;
}
