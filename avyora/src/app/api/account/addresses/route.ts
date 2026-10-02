import { requireAuth, AuthError } from "@/server/auth/rbac";
import { ensureCustomerAddresses, upsertCustomerAddress } from "@/server/customers/addresses";
import { prisma } from "@/server/db";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import { z } from "zod";

export const dynamic = "force-dynamic";

const addressSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1),
  phone: z.string().trim().min(8),
  line1: z.string().trim().min(3),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(1),
  state: z.string().trim().min(1),
  pincode: z.string().trim().regex(/^\d{6}$/),
  isDefault: z.boolean().optional(),
});

async function requireCustomer(request: Request) {
  const session = await requireAuth(request);
  if (!session) {
    throw new AuthError("Customer sign-in required", 401);
  }
  if (session.role !== "CUSTOMER") {
    throw new AuthError("Customer sign-in required", 401);
  }
  const customer = await prisma.customer.findUnique({ where: { userId: session.userId } });
  if (!customer || customer.deletedAt) {
    throw new AuthError("Customer profile not found", 404);
  }
  return { session, customer };
}

export async function GET(request: Request) {
  try {
    const { customer } = await requireCustomer(request);
    const addresses = await ensureCustomerAddresses(customer.id);
    return jsonOk({ addresses });
  } catch (error) {
    if (error instanceof AuthError) return jsonError(error.message, error.status);
    return handleApiError(error, "account/addresses GET");
  }
}

export async function POST(request: Request) {
  try {
    const { customer } = await requireCustomer(request);
    const body = await parseJson(request, addressSchema);
    const saved = await upsertCustomerAddress(customer.id, body, {
      makeDefault: body.isDefault === true,
      existingId: body.id,
    });
    return jsonOk({ address: saved }, 201);
  } catch (error) {
    if (error instanceof AuthError) return jsonError(error.message, error.status);
    if (error instanceof HttpParseError) return jsonError(error.message, 400, error.details);
    return handleApiError(error, "account/addresses POST");
  }
}
