import { hasAnyPermission, PERMISSIONS } from "@/server/auth/permissions";
import { requireAuth, requirePermission } from "@/server/auth/rbac";
import { ensureDb, prisma } from "@/server/db";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import { RepairStatus } from "@prisma/client";
import { z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.nativeEnum(RepairStatus).optional(),
  adminNotes: z.string().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const { id } = await context.params;
    const session = await requireAuth(request);
    if (!session) return jsonError("Authentication required", 401);

    const repair = await prisma.repairRequest.findUnique({ where: { id } });
    if (!repair) return jsonError("Repair request not found", 404);

    const staffCanView = hasAnyPermission(session.permissions, [
      PERMISSIONS.ORDER_VIEW,
      PERMISSIONS.ORDER_UPDATE,
      PERMISSIONS.CUSTOMER_VIEW,
    ]);
    if (!staffCanView) {
      const customer = await prisma.customer.findUnique({
        where: { userId: session.userId },
      });
      if (!customer || repair.customerId !== customer.id) {
        return jsonError("Not found", 404);
      }
    }

    return jsonOk(repair);
  } catch (error) {
    return handleApiError(error, "account/repairs/[id] GET");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await ensureDb();
    const { id } = await context.params;
    await requirePermission(request, PERMISSIONS.ORDER_UPDATE);

    const body = await parseJson(request, patchSchema);

    const repair = await prisma.repairRequest.update({
      where: { id },
      data: {
        status: body.status,
        adminNotes: body.adminNotes,
      },
    });

    return jsonOk(repair);
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "account/repairs/[id] PATCH");
  }
}
