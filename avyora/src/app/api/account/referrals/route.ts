import { requireAuth } from "@/server/auth/rbac";
import { ensureDb, prisma } from "@/server/db";
import { handleApiError, jsonError, jsonOk } from "@/server/http";
import { createHash } from "crypto";

export const dynamic = "force-dynamic";

function buildReferralCode(customerId: string, email: string): string {
  const hash = createHash("sha256").update(`${customerId}:${email}`).digest("hex");
  return `AVY-${hash.slice(0, 8).toUpperCase()}`;
}

export async function GET(request: Request) {
  try {
    await ensureDb();
    const session = await requireAuth(request);
    if (!session) return jsonError("Authentication required", 401);

    const customer = await prisma.customer.findUnique({
      where: { userId: session.userId },
      include: {
        referrals: true,
      },
    });
    if (!customer) return jsonError("Customer profile not found", 404);

    const code = buildReferralCode(customer.id, session.email);
    const referred = await prisma.referral.findMany({
      where: { referrerId: customer.id },
      include: {
        referred: {
          include: { user: { select: { name: true, email: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return jsonOk({ code, referrals: referred });
  } catch (error) {
    return handleApiError(error, "account/referrals GET");
  }
}

export async function POST(request: Request) {
  try {
    await ensureDb();
    const session = await requireAuth(request);
    if (!session) return jsonError("Authentication required", 401);

    const customer = await prisma.customer.findUnique({
      where: { userId: session.userId },
    });
    if (!customer) return jsonError("Customer profile not found", 404);

    const code = buildReferralCode(customer.id, session.email);

    return jsonOk({ code, shareUrl: `/register?ref=${code}` });
  } catch (error) {
    return handleApiError(error, "account/referrals POST");
  }
}
