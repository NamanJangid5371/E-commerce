import { requireAuth, AuthError } from "@/server/auth/rbac";
import { syncCustomerAddressesToCommerce } from "@/server/customers/addresses";
import { prisma } from "@/server/db";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import type { Address } from "@/store/shop-types";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(8).optional(),
  line1: z.string().trim().min(3).optional(),
  line2: z.string().trim().optional().nullable(),
  city: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
  pincode: z.string().trim().regex(/^\d{6}$/).optional(),
  isDefault: z.boolean().optional(),
});

function mapAddress(row: {
  id: string;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}): Address {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2 ?? undefined,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    isDefault: row.isDefault,
  };
}

type Ctx = { params: Promise<{ id: string }> };

async function requireOwnedAddress(request: Request, id: string) {
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
  const address = await prisma.address.findFirst({
    where: { id, customerId: customer.id },
  });
  if (!address) throw new AuthError("Address not found", 404);
  return { customer, address };
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { customer } = await requireOwnedAddress(request, id);
    const body = await parseJson(request, patchSchema);

    const saved = await prisma.$transaction(async (tx) => {
      if (body.isDefault === true) {
        await tx.address.updateMany({
          where: { customerId: customer.id },
          data: { isDefault: false },
        });
      }
      return tx.address.update({
        where: { id },
        data: {
          ...(body.name != null ? { name: body.name } : {}),
          ...(body.phone != null ? { phone: body.phone } : {}),
          ...(body.line1 != null ? { line1: body.line1 } : {}),
          ...(body.line2 !== undefined ? { line2: body.line2 || null } : {}),
          ...(body.city != null ? { city: body.city } : {}),
          ...(body.state != null ? { state: body.state } : {}),
          ...(body.pincode != null ? { pincode: body.pincode } : {}),
          ...(body.isDefault != null ? { isDefault: body.isDefault } : {}),
        },
      });
    });

    await syncCustomerAddressesToCommerce(customer.id);
    return jsonOk({ address: mapAddress(saved) });
  } catch (error) {
    if (error instanceof AuthError) return jsonError(error.message, error.status);
    if (error instanceof HttpParseError) return jsonError(error.message, 400, error.details);
    return handleApiError(error, "account/addresses PATCH");
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { customer, address } = await requireOwnedAddress(request, id);
    await prisma.address.delete({ where: { id } });
    if (address.isDefault) {
      const next = await prisma.address.findFirst({
        where: { customerId: customer.id },
        orderBy: { updatedAt: "desc" },
      });
      if (next) {
        await prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }
    await syncCustomerAddressesToCommerce(customer.id);
    return jsonOk({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return jsonError(error.message, error.status);
    return handleApiError(error, "account/addresses DELETE");
  }
}
