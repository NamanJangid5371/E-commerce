import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "@/server/auth/rbac";
import {
  decimalToNumber,
  generateOrderNumber,
  resolveCheckoutContext,
} from "@/server/checkout/context";
import {
  InsufficientStockError,
  reserveStockInTransaction,
} from "@/server/checkout/reserve-stock";
import { upsertCustomerAddress } from "@/server/customers/addresses";
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
import { mapPrismaOrderToClient, orderDetailInclude } from "@/server/orders/map-order";
import { mirrorClientOrderToCommerce } from "@/server/orders/mirror-commerce";
import { calculateCheckoutTotals } from "@/server/pricing/discounts";

export const dynamic = "force-dynamic";

const addressSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().min(1),
});

const placeSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        sku: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  contactEmail: z.string().email().optional(),
  couponCode: z.string().optional(),
  shippingMethodId: z.string().optional(),
  paymentMethod: z.enum(["razorpay", "cod"]),
  address: addressSchema,
  giftWrap: z.boolean().optional(),
  giftMessage: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await parseJson(request, placeSchema);
    const session = await requireAuth(request);

    let customerId: string | undefined;
    let guestEmail: string | undefined;

    if (session?.role === "CUSTOMER") {
      const customer = await prisma.customer.findUnique({
        where: { userId: session.userId },
      });
      if (!customer) {
        return jsonError("Customer profile not found.", 400);
      }
      // Ownership from JWT only — never trust client email/customerId.
      customerId = customer.id;
    } else if (body.contactEmail) {
      // Guest checkout: never attach an existing customer by email alone (IDOR).
      guestEmail = body.contactEmail.trim().toLowerCase();
    } else {
      return jsonError("Contact email is required for guest checkout.", 400);
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

    // Metadata only — sellable stock is soft-held inside the order transaction
    // (SELECT FOR UPDATE + Inventory.reserved) so concurrent checkouts cannot oversell.
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: context.lines.map((line) => line.variantId) } },
      include: {
        product: {
          include: {
            images: { orderBy: { sortOrder: "asc" }, take: 1 },
          },
        },
      },
    });
    const variantMap = new Map(variants.map((variant) => [variant.id, variant]));

    for (const line of context.lines) {
      if (!variantMap.has(line.variantId)) {
        return jsonError(`Unknown variant: ${line.variantId}.`, 400);
      }
    }

    let shippingMethodName: string | undefined;
    if (body.shippingMethodId) {
      const method = await prisma.shippingMethod.findFirst({
        where: {
          OR: [{ id: body.shippingMethodId }, { legacyId: body.shippingMethodId }],
        },
      });
      shippingMethodName = method?.name;
    }

    const orderNumber = generateOrderNumber();
    // Prepaid stays Pending until Razorpay verify; COD stays Pending until logistics collects cash.
    const paymentStatus = "PENDING" as const;
    const orderStatus =
      body.paymentMethod === "cod" ? "PAYMENT_CONFIRMED" : "PENDING_PAYMENT";

    let savedAddressId: string | undefined;
    if (customerId) {
      try {
        const savedAddress = await upsertCustomerAddress(customerId, {
          ...body.address,
          isDefault: true,
        }, { makeDefault: true });
        savedAddressId = savedAddress.id;
      } catch (error) {
        logger.warn("checkout.place.address_upsert_failed", {
          error: String(error),
          customerId,
        });
      }
    }

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNumber,
          customerId,
          guestEmail,
          status: orderStatus,
          subtotal: totals.subtotal,
          discount: totals.couponDiscount,
          groupDiscount: totals.groupDiscount,
          shipping: totals.shipping,
          tax: totals.tax,
          total: totals.total,
          couponCode: body.couponCode?.trim().toUpperCase(),
          addressId: savedAddressId,
          addressSnapshot: body.address,
          paymentMethod: body.paymentMethod,
          giftWrap: body.giftWrap ?? false,
          giftMessage: body.giftMessage,
          shippingMethodId: body.shippingMethodId,
          shippingMethodName,
          items: {
            create: context.lines.map((line) => {
              const variant = variantMap.get(line.variantId)!;
              const unitPrice = decimalToNumber(variant.salePrice ?? variant.price);
              return {
                productId: line.productId,
                variantId: line.variantId,
                name: variant.product.name,
                sku: variant.sku,
                image: variant.product.images[0]?.url,
                quantity: line.quantity,
                unitPrice,
                lineTotal: unitPrice * line.quantity,
              };
            }),
          },
          payments: {
            create: {
              provider: body.paymentMethod === "razorpay" ? "razorpay" : "cod",
              amount: totals.total,
              status: paymentStatus,
              method: body.paymentMethod,
            },
          },
          statusHistory: {
            create: {
              status: orderStatus,
              note: "Order placed",
            },
          },
        },
      });

      await reserveStockInTransaction(
        tx,
        context.lines.map((line) => {
          const variant = variantMap.get(line.variantId)!;
          return {
            variantId: line.variantId,
            quantity: line.quantity,
            label: `${variant.product.name} (${variant.sku})`,
          };
        }),
        session?.email ?? guestEmail,
        {
          orderId: created.id,
          // COD is payment-confirmed at place — convert soft hold to sale immediately.
          confirmImmediately: body.paymentMethod === "cod",
        },
      );

      if (body.couponCode?.trim() && context.coupon) {
        await tx.coupon.updateMany({
          where: { code: body.couponCode.trim().toUpperCase() },
          data: { usageCount: { increment: 1 } },
        });
      }

      return created;
    });

    try {
      const detailed = await prisma.order.findUnique({
        where: { id: order.id },
        include: orderDetailInclude,
      });
      if (detailed) {
        await mirrorClientOrderToCommerce(mapPrismaOrderToClient(detailed));
      }
    } catch (error) {
      logger.warn("checkout.place.commerce_mirror_failed", { error: String(error), orderId: order.id });
    }

    // Behavioral signal for recommendations (non-blocking)
    try {
      const { ingestUserEvent } = await import("@/server/recommendations/events");
      for (const line of context.lines) {
        await ingestUserEvent({
          userId: session?.userId ?? null,
          eventType: "PURCHASE",
          productId: line.productId,
          metadata: { orderId: order.id, context: "CHECKOUT" },
        });
      }
    } catch (error) {
      logger.warn("checkout.place.purchase_event_failed", { error: String(error) });
    }

    return jsonOk(
      {
        orderId: order.id,
        orderNumber: order.orderNumber,
        total: totals.total,
        paymentMethod: body.paymentMethod,
        paymentStatus,
      },
      201,
    );
  } catch (error) {
    if (error instanceof HttpParseError) {
      return jsonError(error.message, 400, error.details);
    }
    if (error instanceof InsufficientStockError) {
      return jsonError(error.message, error.status);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return jsonError("Could not create order. Please retry.", 409);
    }
    if (isDbUnavailable(error)) {
      logger.error("checkout.place.db_unavailable", { error: String(error) });
      return dbUnavailableError();
    }
    logger.error("checkout.place.failed", { error: String(error) });
    return jsonError("Could not place order.", 500);
  }
}
