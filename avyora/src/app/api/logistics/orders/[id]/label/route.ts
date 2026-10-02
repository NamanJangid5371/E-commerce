import {
  buildShippingLabelPdf,
  shippingLabelFilename,
} from "@/lib/shipping-label-pdf";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { prisma, isDatabaseConfigured } from "@/server/db";
import { handleApiError, jsonError, jsonOk } from "@/server/http";
import { canViewLogistics } from "@/server/logistics/auth";
import { findOpsOrder } from "@/server/logistics/mutations";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const postSchema = z.object({
  action: z.enum(["print", "reprint", "preview"]),
});

function clientIp(request: Request): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || undefined;
  return request.headers.get("x-real-ip") ?? undefined;
}

async function recordLabelAudit(input: {
  session: { userId: string; email: string };
  orderId: string;
  action: "print" | "reprint" | "preview";
  barcodeValue: string;
  ip?: string;
}) {
  if (!isDatabaseConfigured()) return;
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.session.userId,
        actorEmail: input.session.email,
        action:
          input.action === "reprint"
            ? "SHIPPING_LABEL_REPRINTED"
            : input.action === "preview"
              ? "SHIPPING_LABEL_PREVIEWED"
              : "SHIPPING_LABEL_PRINTED",
        entity: "Order",
        entityId: input.orderId,
        detail: `barcode=${input.barcodeValue}`,
        ip: input.ip,
      },
    });
  } catch {
    // Audit must not block label generation/printing.
  }
}

/**
 * GET — authenticated logistics shipping label PDF (server-side data only).
 * Query: action=preview|print|reprint (optional; defaults to preview; does not mutate order status)
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await getSessionFromRequest(request);
    if (!canViewLogistics(session)) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }

    const { id } = await context.params;
    if (!id?.trim()) return jsonError("Order id required", 400);

    const { order } = await findOpsOrder(id);
    if (!order) return jsonError("Order not found", 404);

    const url = new URL(request.url);
    const actionRaw = url.searchParams.get("action") || "preview";
    const action =
      actionRaw === "print" || actionRaw === "reprint" || actionRaw === "preview"
        ? actionRaw
        : "preview";

    const { bytes, meta } = await buildShippingLabelPdf(order, {
      storefrontOrigin: process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN,
    });

    // Preview does not change logistics status; print/reprint only audit.
    if (action === "print" || action === "reprint") {
      await recordLabelAudit({
        session,
        orderId: order.id,
        action,
        barcodeValue: meta.barcodeValue,
        ip: clientIp(request),
      });
    }

    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${shippingLabelFilename(order.id)}"`,
        "Cache-Control": "no-store",
        "X-Label-Barcode": meta.barcodeValue,
        "X-Label-Payment": meta.paymentLabel,
      },
    });
  } catch (error) {
    if (error instanceof Error && /barcode|QR|Cannot generate label/i.test(error.message)) {
      return jsonError(error.message, 422);
    }
    return handleApiError(error, "logistics/orders/[id]/label GET");
  }
}

/**
 * POST — record print/reprint/preview audit after staff confirms (no order mutation).
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await getSessionFromRequest(request);
    if (!canViewLogistics(session)) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }

    const { id } = await context.params;
    if (!id?.trim()) return jsonError("Order id required", 400);

    const { order } = await findOpsOrder(id);
    if (!order) return jsonError("Order not found", 404);

    let body: z.infer<typeof postSchema>;
    try {
      body = postSchema.parse(await request.json());
    } catch {
      return jsonError("Invalid body. Expected { action: print|reprint|preview }", 400);
    }

    const { meta } = await buildShippingLabelPdf(order, {
      storefrontOrigin: process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN,
    });

    await recordLabelAudit({
      session,
      orderId: order.id,
      action: body.action,
      barcodeValue: meta.barcodeValue,
      ip: clientIp(request),
    });

    return jsonOk({
      orderId: order.id,
      action: body.action,
      barcodeValue: meta.barcodeValue,
      qrPayload: meta.qrPayload,
      paymentLabel: meta.paymentLabel,
      packageId: meta.packageId,
      trackingId: meta.trackingId,
    });
  } catch (error) {
    if (error instanceof Error && /barcode|QR|Cannot generate label/i.test(error.message)) {
      return jsonError(error.message, 422);
    }
    return handleApiError(error, "logistics/orders/[id]/label POST");
  }
}
