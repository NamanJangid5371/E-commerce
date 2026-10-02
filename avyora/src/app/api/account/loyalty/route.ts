import { requireAuth } from "@/server/auth/rbac";
import { ensureDb, prisma } from "@/server/db";
import { handleApiError, jsonError, jsonOk } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureDb();
    const session = await requireAuth(request);
    if (!session) return jsonError("Authentication required", 401);

    const customer = await prisma.customer.findUnique({
      where: { userId: session.userId },
    });
    if (!customer) return jsonError("Customer profile not found", 404);

    let account = await prisma.loyaltyAccount.findUnique({
      where: { customerId: customer.id },
      include: {
        transactions: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });

    if (!account) {
      account = await prisma.loyaltyAccount.create({
        data: { customerId: customer.id, balance: 0 },
        include: {
          transactions: { orderBy: { createdAt: "desc" }, take: 50 },
        },
      });
    }

    return jsonOk({
      balance: account.balance,
      tier: account.tier,
      transactions: account.transactions,
    });
  } catch (error) {
    return handleApiError(error, "account/loyalty GET");
  }
}
