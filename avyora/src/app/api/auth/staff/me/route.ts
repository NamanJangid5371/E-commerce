import { getSessionFromRequest } from "@/server/auth/rbac";
import { handleApiError, jsonError, jsonOk } from "@/server/http";

export const dynamic = "force-dynamic";

/** Staff session probe used by admin/logistics layouts (JWT cookie required). */
export async function GET(request: Request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session?.isAdmin) {
      return jsonError("Authentication required", 401);
    }
    return jsonOk({
      userId: session.userId,
      email: session.email,
      role: session.role,
      permissions: session.permissions,
      isAdmin: session.isAdmin,
    });
  } catch (error) {
    return handleApiError(error, "auth/staff/me GET");
  }
}
