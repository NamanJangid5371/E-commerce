import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyPassword } from "@/server/auth/password";
import { issueSessionTokens } from "@/server/auth/issue-session";
import { setAuthCookies } from "@/server/auth/session";
import { prisma } from "@/server/db";
import {
  dbUnavailableError,
  isDbUnavailable,
  jsonError,
} from "@/server/http";
import { logger } from "@/server/logger";
import { assertSecureRuntimeConfig } from "@/server/security/runtime-config";
import { clientIpFromRequest, rateLimit } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";

try {
  assertSecureRuntimeConfig();
} catch (error) {
  console.error(error);
}

const LOCK_THRESHOLD = 5;
const LOCK_MINUTES = 15;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function clientIp(request: Request): string | undefined {
  return clientIpFromRequest(request) || undefined;
}

function resolvePermissions(role: {
  name: string;
  permissions: { permission: { code: string } }[];
}): string[] {
  if (role.name === "SUPER_ADMIN") {
    return ["*"];
  }
  return role.permissions.map((entry) => entry.permission.code);
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(`staff-login:${clientIp(request) ?? "unknown"}`, 20, 15 * 60_000);
    if (!limited.ok) {
      return jsonError("Too many sign-in attempts. Please wait and try again.", 429);
    }

    let body: z.infer<typeof loginSchema>;
    try {
      body = await request.json().then((raw) => loginSchema.parse(raw));
    } catch {
      return jsonError("Invalid email or password.", 400);
    }

    const email = body.email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        adminUser: {
          include: {
            role: {
              include: {
                permissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user || user.role !== "ADMIN" || !user.adminUser) {
      return jsonError("Invalid email or password.", 401);
    }

    if (!user.active) {
      return jsonError("This staff account has been disabled.", 403);
    }

    const now = new Date();
    if (user.lockUntil && user.lockUntil > now) {
      const minutesLeft = Math.ceil(
        (user.lockUntil.getTime() - now.getTime()) / 60_000,
      );
      return jsonError(
        `Account locked. Try again in ${minutesLeft} minute(s).`,
        429,
      );
    }

    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      const failedLogins = user.failedLogins + 1;
      const lockUntil =
        failedLogins >= LOCK_THRESHOLD
          ? new Date(now.getTime() + LOCK_MINUTES * 60_000)
          : null;

      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins, lockUntil },
      });

      await prisma.auditLog.create({
        data: {
          actorId: user.id,
          actorEmail: user.email,
          action: "STAFF_LOGIN_FAILED",
          entity: "User",
          entityId: user.id,
          ip: clientIp(request),
        },
      });

      if (lockUntil) {
        return jsonError(
          `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.`,
          429,
        );
      }

      return jsonError("Invalid email or password.", 401);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockUntil: null },
    });

    const permissions = resolvePermissions(user.adminUser.role);

    const { access, refresh } = await issueSessionTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
      permissions,
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorEmail: user.email,
        action: "STAFF_LOGIN",
        entity: "User",
        entityId: user.id,
        detail: user.adminUser.role.name,
        ip: clientIp(request),
      },
    });

    const response = NextResponse.json({
      ok: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        role: user.adminUser.role.name,
        permissions,
      },
    });
    setAuthCookies(response, access, refresh, "staff");
    return response;
  } catch (error) {
    if (isDbUnavailable(error)) {
      logger.error("auth.staff.login.db_unavailable", { error: String(error) });
      return dbUnavailableError();
    }
    logger.error("auth.staff.login.failed", { error: String(error) });
    return jsonError("Could not sign in. Please try again.", 500);
  }
}
