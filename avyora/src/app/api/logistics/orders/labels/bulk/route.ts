import { isEligibleForShippingLabel } from "@/lib/logistics-orders";
import {
  buildBulkShippingLabelPdf,
  bulkShippingLabelFilename,
} from "@/lib/shipping-label-pdf";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { prisma, isDatabaseConfigured } from "@/server/db";
import { handleApiError, jsonError } from "@/server/http";
import { canViewLogistics } from "@/server/logistics/auth";
import { findOpsOrder } from "@/server/logistics/mutations";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BULK = 40;

const bodySchema = z.object({
  /** Explicit order ids (selected rows). Filtered server-side for eligibility. */
  ids: z.array(z.string().min(1)).min(1).max(MAX_BULK),
});

function clientIp(request: Request): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || undefined;
  return request.headers.get("x-real-ip") ?? undefined;
}

/**
 * POST — bulk sticky shipping labels for eligible new orders only.
 * Skips Pending Payment / Cancelled / Returned / etc. (not meant to be labeled).
 * Returns a multi-page PDF (one label per page).
 */
export async function POST(request: Request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!canViewLogistics(session)) {
      return jsonError(session ? "Insufficient permissions" : "Authentication required", session ? 403 : 401);
    }

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json());
    } catch {
      return jsonError(`Invalid body. Expected { ids: string[] } (max ${MAX_BULK}).`, 400);
    }

    const uniqueIds = [...new Set(body.ids.map((id) => id.trim()).filter(Boolean))];
    const eligibleOrders = [];
    const skipped: { orderId: string; reason: string }[] = [];

    for (const id of uniqueIds) {
      const { order } = await findOpsOrder(id);
      if (!order) {
        skipped.push({ orderId: id, reason: "Order not found" });
        continue;
      }
      const eligibility = isEligibleForShippingLabel(order);
      if (!eligibility.ok) {
        skipped.push({ orderId: order.id, reason: eligibility.reason });
        continue;
      }
      eligibleOrders.push(order);
    }

    if (!eligibleOrders.length) {
      return jsonError(
        skipped.length
          ? `No eligible new orders to label. Skipped: ${skipped
              .slice(0, 8)
              .map((s) => `${s.orderId} (${s.reason})`)
              .join("; ")}`
          : "No orders provided.",
        422,
      );
    }

    const { bytes, included, skipped: genSkipped } = await buildBulkShippingLabelPdf(eligibleOrders, {
      storefrontOrigin: process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN,
    });
    const allSkipped = [...skipped, ...genSkipped];

    if (isDatabaseConfigured()) {
      try {
        await prisma.auditLog.create({
          data: {
            actorId: session.userId,
            actorEmail: session.email,
            action: "SHIPPING_LABEL_BULK_PRINTED",
            entity: "Order",
            entityId: included.map((i) => i.orderId).join(",").slice(0, 190),
            detail: `count=${included.length}; skipped=${allSkipped.length}`,
            ip: clientIp(request),
          },
        });
      } catch {
        // non-blocking
      }
    }

    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${bulkShippingLabelFilename()}"`,
        "Cache-Control": "no-store",
        "X-Label-Count": String(included.length),
        "X-Label-Skipped": String(allSkipped.length),
        "X-Label-Order-Ids": included.map((i) => i.orderId).join(",").slice(0, 1900),
      },
    });
  } catch (error) {
    if (error instanceof Error && /No labels generated|barcode|QR|Cannot generate/i.test(error.message)) {
      return jsonError(error.message, 422);
    }
    return handleApiError(error, "logistics/orders/labels/bulk POST");
  }
}
