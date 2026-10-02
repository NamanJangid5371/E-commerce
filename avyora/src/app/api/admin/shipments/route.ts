import { PERMISSIONS } from "@/server/auth/permissions";
import { requirePermission } from "@/server/auth/rbac";
import { ensureDb, prisma } from "@/server/db";
import { handleApiError, HttpParseError, jsonError, jsonOk, parseJson } from "@/server/http";
import { getCourierProvider } from "@/server/shipping/courier-provider";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  orderId: z.string().min(1),
  weightGrams: z.number().positive().optional(),
  awbOverride: z.string().min(3).max(64).optional(),
  partnerName: z.string().min(1).max(80).optional(),
});

export async function POST(request: Request) {
  try {
    await ensureDb();
    await requirePermission(request, PERMISSIONS.ORDER_UPDATE);

    const body = await parseJson(request, createSchema);

    const order = await prisma.order.findUnique({
      where: { id: body.orderId },
      include: { address: true },
    });
    if (!order) return jsonError("Order not found", 404);

    const snapshot = order.addressSnapshot as {
      name?: string;
      phone?: string;
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      pincode?: string;
    };

    const deliveryAddress = order.address
      ? {
          name: order.address.name,
          phone: order.address.phone,
          line1: order.address.line1,
          line2: order.address.line2 ?? undefined,
          city: order.address.city,
          state: order.address.state,
          pincode: order.address.pincode,
        }
      : {
          name: snapshot.name ?? "Customer",
          phone: snapshot.phone ?? "",
          line1: snapshot.line1 ?? "",
          line2: snapshot.line2,
          city: snapshot.city ?? "",
          state: snapshot.state ?? "",
          pincode: snapshot.pincode ?? "",
        };

    const courier = getCourierProvider();
    const result = await courier.createShipment({
      orderId: order.id,
      orderNumber: order.orderNumber,
      weightGrams: body.weightGrams,
      deliveryAddress,
      awbOverride: body.awbOverride,
      partnerName: body.partnerName,
    });

    const shipment = await prisma.shipment.create({
      data: {
        orderId: order.id,
        courier: courier.name,
        awb: result.awb,
        trackingNumber: result.trackingNumber,
        status: result.status,
        labelUrl: result.labelUrl,
      },
    });

    return jsonOk({ shipment, provider: courier.name }, 201);
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "admin/shipments POST");
  }
}
