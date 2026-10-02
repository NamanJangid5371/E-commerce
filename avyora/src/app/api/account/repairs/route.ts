import { requireAuth } from "@/server/auth/rbac";
import { ensureDb, prisma } from "@/server/db";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import { RepairType } from "@prisma/client";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  orderId: z.string().optional(),
  productName: z.string().optional(),
  type: z.nativeEnum(RepairType),
  description: z.string().min(10),
  imageUrls: z.array(z.string()).default([]),
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

    const repairs = await prisma.repairRequest.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
    });

    return jsonOk(repairs);
  } catch (error) {
    return handleApiError(error, "account/repairs GET");
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

    const body = await parseJson(request, createSchema);

    const repair = await prisma.repairRequest.create({
      data: {
        customerId: customer.id,
        orderId: body.orderId,
        productName: body.productName,
        type: body.type,
        description: body.description,
        imageUrls: body.imageUrls,
      },
    });

    return jsonOk(repair, 201);
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "account/repairs POST");
  }
}
