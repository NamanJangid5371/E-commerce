import { requireAuth } from "@/server/auth/rbac";
import { ensureDb, prisma } from "@/server/db";
import { handleApiError, jsonError, jsonOk } from "@/server/http";
import {
  mapPrismaOrderToClient,
  orderDetailInclude,
  ownershipFilter,
} from "@/server/orders/map-order";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureDb();
    const session = await requireAuth(request);
    if (!session) return jsonError("Authentication required", 401);
    if (session.isAdmin) return jsonError("Use staff logistics APIs for admin order access", 403);

    const customer = await prisma.customer.findUnique({
      where: { userId: session.userId },
    });
    if (!customer) return jsonError("Customer profile not found", 404);

    const orders = await prisma.order.findMany({
      where: ownershipFilter(customer.id, session.email),
      include: orderDetailInclude,
      orderBy: { createdAt: "desc" },
    });

    return jsonOk(orders.map(mapPrismaOrderToClient));
  } catch (error) {
    return handleApiError(error, "account/orders GET");
  }
}
