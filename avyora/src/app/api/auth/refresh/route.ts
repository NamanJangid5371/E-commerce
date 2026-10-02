import { NextResponse } from "next/server";
import { issueSessionTokens } from "@/server/auth/issue-session";
import {
  REFRESH_COOKIE,
  STAFF_REFRESH_COOKIE,
  setAuthCookies,
  verifyRefreshToken,
  type AuthCookieAudience,
} from "@/server/auth/session";
import { prisma } from "@/server/db";
import {
  dbUnavailableError,
  isDbUnavailable,
  jsonError,
} from "@/server/http";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

function extractNamedCookie(request: Request, cookieName: string): string | null {
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

function resolveRefresh(request: Request): { token: string; audience: AuthCookieAudience } | null {
  const staff = extractNamedCookie(request, STAFF_REFRESH_COOKIE);
  if (staff) return { token: staff, audience: "staff" };
  const customer = extractNamedCookie(request, REFRESH_COOKIE);
  if (customer) return { token: customer, audience: "customer" };
  return null;
}

async function loadPermissions(userId: string, role: string): Promise<string[]> {
  if (role !== "ADMIN") return [];

  const adminUser = await prisma.adminUser.findUnique({
    where: { userId },
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  });

  if (!adminUser) return [];
  if (adminUser.role.name === "SUPER_ADMIN") return ["*"];
  return adminUser.role.permissions.map((entry) => entry.permission.code);
}

export async function POST(request: Request) {
  try {
    const resolved = resolveRefresh(request);
    if (!resolved) {
      return jsonError("Refresh token required.", 401);
    }

    let payload: { userId: string };
    try {
      payload = await verifyRefreshToken(resolved.token);
    } catch {
      return jsonError("Invalid or expired refresh token.", 401);
    }

    const stored = await prisma.refreshToken.findUnique({
      where: { token: resolved.token },
    });

    if (!stored || stored.expiresAt < new Date()) {
      if (stored) {
        await prisma.refreshToken.delete({ where: { id: stored.id } });
      }
      return jsonError("Invalid or expired refresh token.", 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user || !user.active) {
      await prisma.refreshToken.deleteMany({ where: { userId: payload.userId } });
      return jsonError("Account unavailable.", 403);
    }

    // Rotate refresh token (single-use).
    await prisma.refreshToken.delete({ where: { id: stored.id } });

    const permissions = await loadPermissions(user.id, user.role);
    const tokens = await issueSessionTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
      permissions,
    });

    const audience: AuthCookieAudience =
      resolved.audience === "staff" || user.role === "ADMIN" ? "staff" : "customer";

    const response = NextResponse.json({
      ok: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        permissions,
        audience,
      },
    });
    setAuthCookies(response, tokens.access, tokens.refresh, audience);
    return response;
  } catch (error) {
    if (isDbUnavailable(error)) {
      logger.error("auth.refresh.db_unavailable", { error: String(error) });
      return dbUnavailableError();
    }
    logger.error("auth.refresh.failed", { error: String(error) });
    return jsonError("Could not refresh session.", 500);
  }
}
