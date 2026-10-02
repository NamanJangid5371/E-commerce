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

export const dynamic = "force-dynamic";

const LOCK_THRESHOLD = 5;
const LOCK_MINUTES = 15;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function clientIp(request: Request): string | undefined {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    undefined
  );
}

export async function POST(request: Request) {
  try {
    let body: z.infer<typeof loginSchema>;
    try {
      body = await request.json().then((raw) => loginSchema.parse(raw));
    } catch {
      return jsonError("Invalid email or password.", 400);
    }

    const email = body.email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email },
      include: { customer: true },
    });

    if (!user || user.role !== "CUSTOMER" || !user.customer) {
      return jsonError("Invalid email or password.", 401);
    }

    if (!user.active) {
      return jsonError("This account has been disabled.", 403);
    }

    if (user.customer.status === "BLOCKED") {
      return jsonError("This account is not available.", 403);
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
        data: {
          failedLogins,
          lockUntil,
        },
      });

      await prisma.auditLog.create({
        data: {
          actorId: user.id,
          actorEmail: user.email,
          action: "LOGIN_FAILED",
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

    const { access, refresh } = await issueSessionTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
      permissions: [],
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorEmail: user.email,
        action: "LOGIN",
        entity: "User",
        entityId: user.id,
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
        customer: {
          id: user.customer.id,
          groupId: user.customer.groupId,
        },
      },
    });
    setAuthCookies(response, access, refresh, "customer");
    return response;
  } catch (error) {
    if (isDbUnavailable(error)) {
      logger.error("auth.login.db_unavailable", { error: String(error) });
      return dbUnavailableError();
    }
    logger.error("auth.login.failed", { error: String(error) });
    return jsonError("Could not sign in. Please try again.", 500);
  }
}
