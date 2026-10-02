import { z } from "zod";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { resolveCheckoutContext } from "@/server/checkout/context";
import { prisma } from "@/server/db";
import {
  dbUnavailableError,
  HttpParseError,
  isDbUnavailable,
  jsonError,
  jsonOk,
  parseJson,
} from "@/server/http";
import { logger } from "@/server/logger";
import { calculateCheckoutTotals } from "@/server/pricing/discounts";

export const dynamic = "force-dynamic";

const previewSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        sku: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  couponCode: z.string().optional(),
  shippingMethodId: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await parseJson(request, previewSchema);
    const session = await getSessionFromRequest(request);

    let customerId: string | undefined;
    if (session?.role === "CUSTOMER") {
      const customer = await prisma.customer.findUnique({
        where: { userId: session.userId },
      });
      customerId = customer?.id;
    }

    let context;
    try {
      context = await resolveCheckoutContext({
        items: body.items,
        couponCode: body.couponCode,
        shippingMethodId: body.shippingMethodId,
        customerId,
      });
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : "Invalid checkout items.",
        400,
      );
    }

    const totals = calculateCheckoutTotals({
      lines: context.lines,
      coupon: context.coupon,
      groupDiscountPercent: context.groupDiscountPercent,
      groupRules: context.groupRules,
      shippingCharge: context.shippingCharge,
      freeShippingAbove: context.freeShippingAbove,
    });

    return jsonOk({
      lines: context.lines,
      totals,
      couponApplied: Boolean(context.coupon),
    });
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    if (isDbUnavailable(error)) {
      logger.error("checkout.preview.db_unavailable", { error: String(error) });
      return dbUnavailableError();
    }
    logger.error("checkout.preview.failed", { error: String(error) });
    return jsonError("Could not preview checkout.", 500);
  }
}
