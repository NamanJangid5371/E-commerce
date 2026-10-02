import { z } from "zod";
import { requireAuth } from "@/server/auth/rbac";
import { ensureDb, prisma } from "@/server/db";
import {
  handleApiError,
  HttpParseError,
  jsonError,
  jsonOk,
  parseJson,
} from "@/server/http";
import { createCustomerReturn, listReturns } from "@/server/returns/return-service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  orderId: z.string().min(1),
  orderItemId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
  description: z.string().trim().max(2000).optional(),
  quantity: z.number().int().positive().optional(),
  imageUrls: z.array(z.string().url().or(z.string().startsWith("/"))).max(6).optional(),
});

/** List the signed-in customer's return requests. */
export async function GET(request: Request) {
  try {
    await ensureDb();
    const session = await requireAuth(request);
    if (!session) return jsonError("Authentication required", 401);
    if (session.isAdmin) return jsonError("Use staff return APIs", 403);

    const customer = await prisma.customer.findUnique({ where: { userId: session.userId } });
    if (!customer) return jsonError("Customer profile not found", 404);

    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get("page") ?? "1") || 1;
    const result = await listReturns({ customerId: customer.id, page, pageSize: 50 });
    return jsonOk(result);
  } catch (error) {
    return handleApiError(error, "account/returns GET");
  }
}

/** Customer creates an item-level return request (15-day window enforced). */
export async function POST(request: Request) {
  try {
    await ensureDb();
    const session = await requireAuth(request);
    if (!session) return jsonError("Authentication required", 401);
    if (session.isAdmin) {
      return jsonError("Return requests must be submitted by the customer account.", 403);
    }

    const customer = await prisma.customer.findUnique({ where: { userId: session.userId } });
    if (!customer) return jsonError("Customer profile not found", 404);

    const body = await parseJson(request, createSchema);
    const result = await createCustomerReturn({
      customerId: customer.id,
      customerEmail: session.email,
      orderIdOrNumber: body.orderId,
      orderItemId: body.orderItemId,
      reason: body.reason,
      description: body.description,
      quantity: body.quantity,
      imageUrls: body.imageUrls,
    });

    if (!result.ok) return jsonError(result.message, result.status);
    return jsonOk(result.data, 201);
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "account/returns POST");
  }
}
