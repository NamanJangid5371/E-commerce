import { requireAuth } from "@/server/auth/rbac";
import { ensureDb, prisma } from "@/server/db";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import { BespokeStatus } from "@prisma/client";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  jewelleryType: z.string().min(1),
  metal: z.string().optional(),
  purity: z.string().optional(),
  stone: z.string().optional(),
  size: z.string().optional(),
  budgetMin: z.number().optional(),
  budgetMax: z.number().optional(),
  engraving: z.string().optional(),
  notes: z.string().optional(),
  referenceUrls: z.array(z.string()).default([]),
  guestEmail: z.string().email().optional(),
});

export async function GET(request: Request) {
  try {
    await ensureDb();
    const session = await requireAuth(request);
    if (!session) return jsonError("Authentication required", 401);

    const customer = await prisma.customer.findUnique({
      where: { userId: session.userId },
    });

    if (!customer) return jsonError("Customer profile not found", 404);

    const orders = await prisma.bespokeOrder.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      include: { history: { orderBy: { createdAt: "desc" }, take: 5 } },
    });

    return jsonOk(orders);
  } catch (error) {
    return handleApiError(error, "bespoke GET");
  }
}

export async function POST(request: Request) {
  try {
    await ensureDb();
    const session = await requireAuth(request);
    const body = await parseJson(request, createSchema);

    const customer = session
      ? await prisma.customer.findUnique({ where: { userId: session.userId } })
      : null;

    const order = await prisma.bespokeOrder.create({
      data: {
        customerId: customer?.id,
        guestEmail: customer ? undefined : body.guestEmail,
        jewelleryType: body.jewelleryType,
        metal: body.metal,
        purity: body.purity,
        stone: body.stone,
        size: body.size,
        budgetMin: body.budgetMin,
        budgetMax: body.budgetMax,
        engraving: body.engraving,
        notes: body.notes,
        referenceUrls: body.referenceUrls,
        status: BespokeStatus.SUBMITTED,
        history: {
          create: {
            status: BespokeStatus.SUBMITTED,
            note: "Request submitted",
          },
        },
      },
      include: { history: true },
    });

    return jsonOk(order, 201);
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "bespoke POST");
  }
}
