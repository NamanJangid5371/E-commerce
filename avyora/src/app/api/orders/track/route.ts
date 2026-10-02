import { z } from "zod";
import { ensureDb, prisma } from "@/server/db";
import {
  handleApiError,
  HttpParseError,
  jsonError,
  jsonOk,
  parseJson,
} from "@/server/http";
import { mapPrismaOrderToClient, orderDetailInclude } from "@/server/orders/map-order";

export const dynamic = "force-dynamic";

const trackSchema = z.object({
  orderId: z.string().trim().min(1),
  email: z.string().trim().email(),
});

/**
 * Guest-safe order lookup: order number/id + checkout email.
 * Always returns the same 404 message to avoid account enumeration.
 */
export async function POST(request: Request) {
  try {
    await ensureDb();
    const body = await parseJson(request, trackSchema);
    const email = body.email.trim().toLowerCase();
    const orderKey = body.orderId.trim();

    const order = await prisma.order.findFirst({
      where: {
        OR: [{ orderNumber: orderKey }, { id: orderKey }, { legacyId: orderKey }],
      },
      include: orderDetailInclude,
    });

    if (!order) {
      return jsonError("No order found with that ID and email.", 404);
    }

    const ownerEmail =
      order.guestEmail?.trim().toLowerCase() ||
      order.customer?.user?.email?.trim().toLowerCase() ||
      "";

    if (!ownerEmail || ownerEmail !== email) {
      return jsonError("No order found with that ID and email.", 404);
    }

    return jsonOk(mapPrismaOrderToClient(order));
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    return handleApiError(error, "orders/track POST");
  }
}
