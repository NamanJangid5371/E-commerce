import { prisma } from "@/server/db";
import type { GroupRule, PricingLine } from "@/server/pricing/discounts";

export type CheckoutItemInput = {
  productId: string;
  sku: string;
  quantity: number;
};

export type ResolvedCheckoutContext = {
  lines: PricingLine[];
  groupDiscountPercent?: number;
  groupRules: GroupRule[];
  shippingCharge: number;
  freeShippingAbove: number;
  coupon?: {
    type: "PERCENT" | "FLAT" | "FREE_SHIPPING";
    value: number;
    minOrder: number;
    maxDiscount?: number;
  };
};

function toNumber(value: { toNumber?: () => number } | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}

export async function resolveCheckoutContext(input: {
  items: CheckoutItemInput[];
  couponCode?: string;
  shippingMethodId?: string;
  customerId?: string;
}): Promise<ResolvedCheckoutContext> {
  const skus = input.items.map((item) => item.sku);

  const variants = await prisma.productVariant.findMany({
    where: { sku: { in: skus } },
    include: {
      product: {
        include: {
          collections: {
            take: 1,
            orderBy: { sortOrder: "asc" },
          },
        },
      },
    },
  });

  const variantBySku = new Map(variants.map((variant) => [variant.sku, variant]));

  const lines: PricingLine[] = [];
  for (const item of input.items) {
    const variant = variantBySku.get(item.sku);
    if (!variant) {
      throw new Error(`Invalid item: ${item.sku}`);
    }
    const productMatches =
      variant.productId === item.productId || variant.product.legacyId === item.productId;
    if (!productMatches) {
      throw new Error(`Invalid item: ${item.sku}`);
    }
    if (variant.product.status !== "PUBLISHED") {
      throw new Error(`Product unavailable: ${item.sku}`);
    }

    const unitPrice = toNumber(variant.salePrice ?? variant.price);
    lines.push({
      productId: variant.productId,
      variantId: variant.id,
      quantity: item.quantity,
      unitPrice,
      categoryId: variant.product.categoryId ?? undefined,
      collectionId: variant.product.collections[0]?.collectionId,
    });
  }

  let groupDiscountPercent: number | undefined;
  let groupRules: GroupRule[] = [];

  if (input.customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: input.customerId },
      include: {
        group: {
          include: {
            discountRules: {
              where: { active: true },
              orderBy: { priority: "desc" },
            },
          },
        },
      },
    });

    if (customer?.group) {
      groupDiscountPercent = toNumber(customer.group.discountPercent);
      groupRules = customer.group.discountRules.map((rule) => ({
        type: rule.type,
        value: toNumber(rule.value),
        maxDiscount: rule.maxDiscount ? toNumber(rule.maxDiscount) : undefined,
        productId: rule.productId ?? undefined,
        categoryId: rule.categoryId ?? undefined,
        collectionId: rule.collectionId ?? undefined,
        stackable: rule.stackable,
        priority: rule.priority,
      }));
    }
  }

  let shippingCharge = 0;
  let freeShippingAbove = Number.MAX_SAFE_INTEGER;

  if (input.shippingMethodId) {
    const method = await prisma.shippingMethod.findFirst({
      where: {
        active: true,
        OR: [{ id: input.shippingMethodId }, { legacyId: input.shippingMethodId }],
      },
    });
    if (method) {
      shippingCharge = toNumber(method.charge);
      freeShippingAbove = method.freeAbove
        ? toNumber(method.freeAbove)
        : Number.MAX_SAFE_INTEGER;
    } else {
      // Fallback when ops shipping ids are not yet mirrored into Postgres.
      shippingCharge = 199;
      freeShippingAbove = 7999;
    }
  } else {
    const defaultMethod = await prisma.shippingMethod.findFirst({
      where: { active: true },
      orderBy: { createdAt: "asc" },
    });
    if (defaultMethod) {
      shippingCharge = toNumber(defaultMethod.charge);
      freeShippingAbove = defaultMethod.freeAbove
        ? toNumber(defaultMethod.freeAbove)
        : Number.MAX_SAFE_INTEGER;
    } else {
      shippingCharge = 199;
      freeShippingAbove = 7999;
    }
  }

  let coupon: ResolvedCheckoutContext["coupon"];
  if (input.couponCode?.trim()) {
    const code = input.couponCode.trim().toUpperCase();
    const now = new Date();
    const record = await prisma.coupon.findFirst({
      where: {
        code,
        active: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
    });

    if (record && (record.usageLimit == null || record.usageCount < record.usageLimit)) {
      coupon = {
        type: record.type,
        value: toNumber(record.value),
        minOrder: toNumber(record.minOrder),
        maxDiscount: record.maxDiscount ? toNumber(record.maxDiscount) : undefined,
      };
    }
  }

  return {
    lines,
    groupDiscountPercent,
    groupRules,
    shippingCharge,
    freeShippingAbove,
    coupon,
  };
}

export function generateOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AVY-${ts}-${rand}`;
}

export function decimalToNumber(
  value: { toNumber?: () => number } | number | null | undefined,
): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}
