import { PERMISSIONS, hasPermission } from "@/server/auth/permissions";
import { requireAuth } from "@/server/auth/rbac";
import { ensureDb, prisma } from "@/server/db";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  customerId: z.string().min(1),
  productId: z.string().optional(),
  orderId: z.string().optional(),
  number: z.string().min(1),
  type: z.string().min(1),
  issueDate: z.string().datetime().optional(),
  documentUrl: z.string().url().optional(),
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

    const certificates = await prisma.certificate.findMany({
      where: { customerId: customer.id },
      include: { product: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: "desc" },
    });

    return jsonOk(certificates);
  } catch (error) {
    return handleApiError(error, "account/certificates GET");
  }
}

export async function POST(request: Request) {
  try {
    await ensureDb();
    const session = await requireAuth(request);
    if (!session) return jsonError("Authentication required", 401);

    const canCreate =
      hasPermission(session.permissions, PERMISSIONS.ORDER_UPDATE) ||
      hasPermission(session.permissions, PERMISSIONS.SETTINGS_MANAGE);

    if (!canCreate) return jsonError("Insufficient permissions", 403);

    const body = await parseJson(request, createSchema);

    const certificate = await prisma.certificate.create({
      data: {
        customerId: body.customerId,
        productId: body.productId,
        orderId: body.orderId,
        number: body.number,
        type: body.type,
        issueDate: body.issueDate ? new Date(body.issueDate) : undefined,
        documentUrl: body.documentUrl,
      },
    });

    return jsonOk(certificate, 201);
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "account/certificates POST");
  }
}
