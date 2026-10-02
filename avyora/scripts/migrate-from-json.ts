import {
  PrismaClient,
  ProductStatus,
  CouponType,
  UserRole,
  OrderStatus,
  CustomerStatus,
  PaymentStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import type { Product, Coupon } from "../src/data/types";
import type { Customer, Order } from "../src/store/shop-types";

const prisma = new PrismaClient();
const COMMERCE_PATH = path.join(process.cwd(), "data", "commerce.json");
const BCRYPT_COST = 12;
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? "";
if (!DEFAULT_ADMIN_PASSWORD) {
  console.warn(
    "[migrate-from-json] ADMIN_SEED_PASSWORD not set — admin password upserts will be skipped where hash is required.",
  );
}

type CommerceJson = {
  catalog?: Product[];
  collections?: { slug: string; name: string; tagline?: string; description?: string; image?: string; productSlugs?: string[] }[];
  coupons?: Coupon[];
  customers?: Customer[];
  orders?: (Order & {
    customerEmail?: string;
    paymentStatus?: string;
    paymentMethod?: string;
    tax?: number;
  })[];
  ops?: {
    adminUsers?: {
      id: string;
      name: string;
      email: string;
      role: string;
      active?: boolean;
      password?: string;
    }[];
    groups?: {
      id: string;
      name: string;
      discountPercent: number;
      benefits?: string;
    }[];
    categories?: { id: string; name: string; slug: string }[];
    brands?: { id: string; name: string; slug: string }[];
  };
};

const ORDER_STATUS_MAP: Record<string, OrderStatus> = {
  "Pending Payment": OrderStatus.PENDING_PAYMENT,
  Confirmed: OrderStatus.CONFIRMED,
  Packed: OrderStatus.PACKED,
  Shipped: OrderStatus.SHIPPED,
  Delivered: OrderStatus.DELIVERED,
  "Return Requested": OrderStatus.RETURN_REQUESTED,
  Refunded: OrderStatus.REFUNDED,
  Processing: OrderStatus.PROCESSING,
  Cancelled: OrderStatus.CANCELLED,
};

const ROLE_NAME_MAP: Record<string, string> = {
  "Super Admin": "SUPER_ADMIN",
  "Catalog Manager": "Catalog Manager",
  "Order Manager": "Order Manager",
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function mapProductStatus(status?: string): ProductStatus {
  switch (status?.toLowerCase()) {
    case "draft":
      return ProductStatus.DRAFT;
    case "archived":
      return ProductStatus.ARCHIVED;
    default:
      return ProductStatus.PUBLISHED;
  }
}

function mapCouponType(type: string): CouponType {
  switch (type.toLowerCase()) {
    case "flat":
      return CouponType.FLAT;
    case "free_shipping":
      return CouponType.FREE_SHIPPING;
    default:
      return CouponType.PERCENT;
  }
}

function mapPaymentStatus(status?: string): PaymentStatus {
  switch (status?.toLowerCase()) {
    case "success":
      return PaymentStatus.SUCCESS;
    case "failed":
      return PaymentStatus.FAILED;
    case "refunded":
      return PaymentStatus.REFUNDED;
    default:
      return PaymentStatus.PENDING;
  }
}

async function ensureWarehouse() {
  return prisma.warehouse.upsert({
    where: { code: "MAIN" },
    create: { code: "MAIN", name: "Main Warehouse", isDefault: true, active: true },
    update: { isDefault: true, active: true },
  });
}

async function importGroups(groups: NonNullable<CommerceJson["ops"]>["groups"] = []) {
  let count = 0;
  for (const group of groups) {
    await prisma.customerGroup.upsert({
      where: { legacyId: group.id },
      create: {
        legacyId: group.id,
        name: group.name,
        discountPercent: group.discountPercent,
        benefits: group.benefits,
      },
      update: {
        name: group.name,
        discountPercent: group.discountPercent,
        benefits: group.benefits,
      },
    });
    count += 1;
  }
  return count;
}

async function importCatalog(catalog: Product[], warehouseId: string) {
  let count = 0;

  for (const product of catalog) {
    const brandSlug = slugify(product.brand);
    const brand = await prisma.brand.upsert({
      where: { slug: brandSlug },
      create: { name: product.brand, slug: brandSlug, legacyId: `br-${brandSlug}` },
      update: { name: product.brand },
    });

    const categorySlug = slugify(product.category);
    const category = await prisma.category.upsert({
      where: { slug: categorySlug },
      create: { name: product.category, slug: categorySlug, legacyId: `cat-${categorySlug}` },
      update: { name: product.category },
    });

    const dbProduct = await prisma.product.upsert({
      where: { legacyId: product.id },
      create: {
        legacyId: product.id,
        sku: product.sku,
        slug: product.slug,
        name: product.name,
        brandId: brand.id,
        categoryId: category.id,
        collectionSlug: product.collection,
        tags: product.tags,
        description: product.description,
        story: product.story,
        metal: product.metal,
        purity: product.purity,
        colour: product.colour,
        stone: product.stone,
        cut: product.cut,
        clarity: product.clarity,
        carat: product.carat,
        weight: product.weight,
        dimensions: product.dimensions,
        makingCharge: product.makingCharge,
        taxNote: product.taxNote,
        certificateNumber: product.certificateNumber,
        certifiedBy: product.certifiedBy,
        warranty: product.warranty,
        care: product.care,
        returnPolicy: product.returnPolicy,
        seoTitle: product.seoTitle,
        seoDescription: product.seoDescription,
        featured: product.featured ?? false,
        bestSeller: product.bestSeller ?? false,
        newArrival: product.newArrival ?? false,
        status: mapProductStatus(product.status),
        rating: product.rating,
        reviewCount: product.reviewCount,
      },
      update: {
        name: product.name,
        status: mapProductStatus(product.status),
        rating: product.rating,
        reviewCount: product.reviewCount,
      },
    });

    await prisma.productImage.deleteMany({ where: { productId: dbProduct.id } });
    if (product.images?.length) {
      await prisma.productImage.createMany({
        data: product.images.map((url, index) => ({
          productId: dbProduct.id,
          url,
          alt: product.name,
          sortOrder: index,
        })),
      });
    }

    for (const variant of product.variants) {
      const dbVariant = await prisma.productVariant.upsert({
        where: { sku: variant.sku },
        create: {
          productId: dbProduct.id,
          sku: variant.sku,
          size: variant.size,
          metal: variant.metal,
          purity: variant.purity,
          colour: variant.colour,
          stock: variant.stock,
          price: variant.price,
          salePrice: variant.salePrice,
        },
        update: {
          stock: variant.stock,
          price: variant.price,
          salePrice: variant.salePrice,
        },
      });

      await prisma.inventory.upsert({
        where: {
          warehouseId_variantId: { warehouseId, variantId: dbVariant.id },
        },
        create: {
          warehouseId,
          productId: dbProduct.id,
          variantId: dbVariant.id,
          quantity: variant.stock,
        },
        update: { quantity: variant.stock },
      });
    }

    count += 1;
  }

  return count;
}

async function importCoupons(couponList: Coupon[]) {
  let count = 0;
  for (const coupon of couponList) {
    await prisma.coupon.upsert({
      where: { code: coupon.code },
      create: {
        legacyId: coupon.code,
        code: coupon.code,
        type: mapCouponType(coupon.type),
        value: coupon.value,
        minOrder: coupon.minOrder,
        maxDiscount: coupon.maxDiscount,
        usageLimit: coupon.usageLimit,
        usageCount: coupon.usageCount ?? 0,
        active: coupon.active ?? true,
        startsAt: coupon.startsAt ? new Date(coupon.startsAt) : undefined,
        endsAt: coupon.endsAt ? new Date(coupon.endsAt) : undefined,
      },
      update: {
        type: mapCouponType(coupon.type),
        value: coupon.value,
        minOrder: coupon.minOrder,
        active: coupon.active ?? true,
        usageCount: coupon.usageCount ?? 0,
      },
    });
    count += 1;
  }
  return count;
}

async function importCustomers(customers: Customer[]) {
  let count = 0;

  for (const customer of customers) {
    const email = customer.email.trim().toLowerCase();
    const passwordHash = customer.password
      ? await bcrypt.hash(customer.password, BCRYPT_COST)
      : DEFAULT_ADMIN_PASSWORD
        ? await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, BCRYPT_COST)
        : await bcrypt.hash(`migrate-temp-${email}-${Date.now()}`, BCRYPT_COST);

    const group = customer.groupId
      ? await prisma.customerGroup.findUnique({ where: { legacyId: customer.groupId } })
      : null;

    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        name: customer.name,
        passwordHash,
        role: UserRole.CUSTOMER,
        active: customer.status !== "blocked",
        failedLogins: customer.failedLogins ?? 0,
        lockUntil: customer.lockUntil ? new Date(customer.lockUntil) : undefined,
      },
      update: {
        name: customer.name,
        active: customer.status !== "blocked",
      },
    });

    const dbCustomer = await prisma.customer.upsert({
      where: { legacyId: customer.id },
      create: {
        legacyId: customer.id,
        userId: user.id,
        phone: customer.phone,
        status: customer.status === "blocked" ? CustomerStatus.BLOCKED : CustomerStatus.ACTIVE,
        notes: customer.notes,
        emailVerified: customer.emailVerified ?? false,
        phoneVerified: customer.phoneVerified ?? false,
        preferredRingSize: customer.preferredRingSize,
        groupId: group?.id,
      },
      update: {
        phone: customer.phone,
        status: customer.status === "blocked" ? CustomerStatus.BLOCKED : CustomerStatus.ACTIVE,
        groupId: group?.id,
      },
    });

    if (customer.addresses?.length) {
      for (const address of customer.addresses) {
        const existing = await prisma.address.findFirst({
          where: { customerId: dbCustomer.id, line1: address.line1, pincode: address.pincode },
        });
        if (!existing) {
          await prisma.address.create({
            data: {
              customerId: dbCustomer.id,
              name: address.name,
              phone: address.phone,
              line1: address.line1,
              line2: address.line2,
              city: address.city,
              state: address.state,
              pincode: address.pincode,
              isDefault: customer.addresses[0]?.id === address.id,
            },
          });
        }
      }
    }

    count += 1;
  }

  return count;
}

async function importAdminUsers(
  adminUsers: NonNullable<CommerceJson["ops"]>["adminUsers"] = [],
) {
  let count = 0;

  for (const admin of adminUsers) {
    const roleName = ROLE_NAME_MAP[admin.role] ?? admin.role;
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      console.warn(`[migrate] Skipping admin ${admin.email}: role "${roleName}" not found. Run seed first.`);
      continue;
    }

    const email = admin.email.trim().toLowerCase();
    const passwordHash = admin.password
      ? await bcrypt.hash(admin.password, BCRYPT_COST)
      : DEFAULT_ADMIN_PASSWORD
        ? await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, BCRYPT_COST)
        : null;

    if (!passwordHash) {
      console.warn(`[migrate] Skipping admin ${admin.email}: set ADMIN_SEED_PASSWORD or provide password in JSON.`);
      continue;
    }

    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        name: admin.name,
        passwordHash,
        role: UserRole.ADMIN,
        active: admin.active ?? true,
      },
      update: {
        name: admin.name,
        role: UserRole.ADMIN,
        active: admin.active ?? true,
      },
    });

    await prisma.adminUser.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        roleId: role.id,
        legacyId: admin.id,
      },
      update: {
        roleId: role.id,
        legacyId: admin.id,
      },
    });

    count += 1;
  }

  return count;
}

async function importOrders(orders: CommerceJson["orders"] = []) {
  let count = 0;

  for (const order of orders) {
    const existing = await prisma.order.findUnique({ where: { legacyId: order.id } });
    if (existing) continue;

    let customerId: string | undefined;
    if (order.customerEmail) {
      const user = await prisma.user.findUnique({
        where: { email: order.customerEmail.toLowerCase() },
        include: { customer: true },
      });
      customerId = user?.customer?.id;
    }

    const status = ORDER_STATUS_MAP[order.status] ?? OrderStatus.CONFIRMED;
    const orderNumber = order.id.startsWith("AV") ? order.id : `AV-${order.id}`;

    const dbOrder = await prisma.order.create({
      data: {
        legacyId: order.id,
        orderNumber,
        customerId,
        guestEmail: customerId ? undefined : order.customerEmail,
        status,
        subtotal: order.subtotal,
        discount: order.discount,
        shipping: order.shipping,
        tax: order.tax ?? 0,
        total: order.total,
        couponCode: order.coupon,
        trackingId: order.trackingId,
        paymentMethod: order.paymentMethod,
        addressSnapshot: order.address,
        createdAt: new Date(order.createdAt),
      },
    });

    for (const item of order.items) {
      const product = await prisma.product.findFirst({
        where: { OR: [{ legacyId: item.productId }, { slug: item.productId }] },
      });
      const variant = await prisma.productVariant.findUnique({ where: { sku: item.sku } });

      if (!product || !variant) {
        console.warn(`[migrate] Skipping order item ${item.sku} — product/variant not found.`);
        continue;
      }

      await prisma.orderItem.create({
        data: {
          orderId: dbOrder.id,
          productId: product.id,
          variantId: variant.id,
          name: item.name,
          sku: item.sku,
          image: item.image,
          quantity: item.quantity,
          unitPrice: item.price,
          lineTotal: item.price * item.quantity,
        },
      });
    }

    if (order.paymentId) {
      await prisma.payment.create({
        data: {
          orderId: dbOrder.id,
          providerPaymentId: order.paymentId,
          amount: order.total,
          status: mapPaymentStatus(order.paymentStatus),
          method: order.paymentMethod,
        },
      });
    }

    await prisma.orderStatusHistory.create({
      data: {
        orderId: dbOrder.id,
        status,
        note: "Imported from commerce.json",
      },
    });

    count += 1;
  }

  return count;
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("[migrate] DATABASE_URL is not set. Export it and retry.");
    process.exit(1);
  }

  if (!fs.existsSync(COMMERCE_PATH)) {
    console.info("[migrate] data/commerce.json not found — skipping migration.");
    return;
  }

  const raw = fs.readFileSync(COMMERCE_PATH, "utf8");
  const data = JSON.parse(raw) as CommerceJson;

  console.info("[migrate] Importing from data/commerce.json (file is never deleted)…");

  const warehouse = await ensureWarehouse();

  const groupCount = await importGroups(data.ops?.groups ?? []);
  const catalogCount = await importCatalog(data.catalog ?? [], warehouse.id);
  const couponCount = await importCoupons(data.coupons ?? []);
  const customerCount = await importCustomers(data.customers ?? []);
  const adminCount = await importAdminUsers(data.ops?.adminUsers ?? []);
  const orderCount = await importOrders(data.orders ?? []);

  console.info("[migrate] Import complete.");
  console.info(`  Customer groups: ${groupCount}`);
  console.info(`  Catalog products: ${catalogCount}`);
  console.info(`  Coupons: ${couponCount}`);
  console.info(`  Customers: ${customerCount}`);
  console.info(`  Admin users: ${adminCount}`);
  console.info(`  Orders: ${orderCount}`);
}

main()
  .catch((error) => {
    console.error("[migrate] Failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export default main;
