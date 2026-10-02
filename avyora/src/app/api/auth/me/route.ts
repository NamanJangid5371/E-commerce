import { getSessionFromRequest } from "@/server/auth/rbac";
import { ensureDb, prisma } from "@/server/db";
import { handleApiError, jsonError, jsonOk } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Customer (storefront) session probe.
 * Returns 401 for missing session or staff JWTs — staff must use /api/auth/staff/me.
 */
export async function GET(request: Request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return jsonError("Authentication required", 401);
    }
    if (session.isAdmin) {
      return jsonError("Staff session — use staff APIs", 403);
    }

    await ensureDb();
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      include: { customer: true },
    });

    if (!user || user.role !== "CUSTOMER" || !user.customer || !user.active) {
      return jsonError("Authentication required", 401);
    }

    if (user.customer.status === "BLOCKED") {
      return jsonError("This account is not available.", 403);
    }

    return jsonOk({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: "customer" as const,
      },
      customer: {
        id: user.customer.id,
        groupId: user.customer.groupId,
        emailVerified: user.customer.emailVerified,
      },
    });
  } catch (error) {
    return handleApiError(error, "auth/me GET");
  }
}
