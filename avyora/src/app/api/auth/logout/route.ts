import { NextResponse } from "next/server";
import { getSessionFromRequest, isStaffPortalRequest } from "@/server/auth/rbac";
import { clearAuthCookies } from "@/server/auth/session";
import { prisma } from "@/server/db";
import {
  dbUnavailableError,
  isDbUnavailable,
  jsonError,
  jsonOk,
} from "@/server/http";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getSessionFromRequest(request);
    const audience = session?.isAdmin || isStaffPortalRequest(request) ? "staff" : "customer";

    if (session) {
      try {
        await prisma.refreshToken.deleteMany({
          where: { userId: session.userId },
        });

        await prisma.auditLog.create({
          data: {
            actorId: session.userId,
            actorEmail: session.email,
            action: "LOGOUT",
            entity: "User",
            entityId: session.userId,
          },
        });
      } catch {
        /* still clear cookies */
      }
    }

    const response = NextResponse.json({ ok: true, data: { loggedOut: true } });
    // Only clear the audience being signed out — keep the other portal session alive.
    clearAuthCookies(response, audience);
    return response;
  } catch (error) {
    if (isDbUnavailable(error)) {
      logger.error("auth.logout.db_unavailable", { error: String(error) });
      return dbUnavailableError();
    }
    logger.error("auth.logout.failed", { error: String(error) });
    return jsonError("Could not sign out. Please try again.", 500);
  }
}

export async function GET() {
  return jsonOk({ message: "Use POST to sign out." });
}
