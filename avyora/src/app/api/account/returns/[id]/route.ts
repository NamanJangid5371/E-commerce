import { requireAuth } from "@/server/auth/rbac";
import { ensureDb, prisma } from "@/server/db";
import { handleApiError, jsonError, jsonOk } from "@/server/http";
import { getReturnById, transitionReturn } from "@/server/returns/return-service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Customer views a single return (own only). */
export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const session = await requireAuth(request);
    if (!session) return jsonError("Authentication required", 401);
    if (session.isAdmin) return jsonError("Use staff return APIs", 403);

    const customer = await prisma.customer.findUnique({ where: { userId: session.userId } });
    if (!customer) return jsonError("Customer profile not found", 404);

    const { id } = await context.params;
    const data = await getReturnById(id);
    if (!data || data.customerId !== customer.id) return jsonError("Not found", 404);
    return jsonOk(data);
  } catch (error) {
    return handleApiError(error, "account/returns/[id] GET");
  }
}

/** Customer cancels a return when still permitted (requested/approved). */
export async function POST(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const session = await requireAuth(request);
    if (!session) return jsonError("Authentication required", 401);
    if (session.isAdmin) return jsonError("Use staff return APIs", 403);

    const customer = await prisma.customer.findUnique({ where: { userId: session.userId } });
    if (!customer) return jsonError("Customer profile not found", 404);

    const { id } = await context.params;
    const existing = await getReturnById(id);
    if (!existing || existing.customerId !== customer.id) return jsonError("Not found", 404);

    const result = await transitionReturn({
      id,
      to: "RETURN_CANCELLED",
      role: "customer",
      actorEmail: session.email,
      note: "Cancelled by customer",
    });
    if (!result.ok) return jsonError(result.message, result.status);
    return jsonOk(result.data);
  } catch (error) {
    return handleApiError(error, "account/returns/[id] cancel");
  }
}
