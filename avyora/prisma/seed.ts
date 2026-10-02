import { PrismaClient, ProductStatus, CouponType, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { products, collections, coupons } from "../src/data/catalog";
import type { Product } from "../src/data/types";

const prisma = new PrismaClient();

const PERMISSIONS = {
  PRODUCT_VIEW: "PRODUCT_VIEW",
  PRODUCT_CREATE: "PRODUCT_CREATE",
  PRODUCT_UPDATE: "PRODUCT_UPDATE",
  PRODUCT_DELETE: "PRODUCT_DELETE",
  ORDER_VIEW: "ORDER_VIEW",
  ORDER_UPDATE: "ORDER_UPDATE",
  ORDER_CANCEL: "ORDER_CANCEL",
  ORDER_REFUND: "ORDER_REFUND",
  DISPATCH: "DISPATCH",
  CUSTOMER_VIEW: "CUSTOMER_VIEW",
  CUSTOMER_UPDATE: "CUSTOMER_UPDATE",
  INVENTORY_VIEW: "INVENTORY_VIEW",
  INVENTORY_UPDATE: "INVENTORY_UPDATE",
  REPORT_VIEW: "REPORT_VIEW",
  SETTINGS_MANAGE: "SETTINGS_MANAGE",
  MEDIA_MANAGE: "MEDIA_MANAGE",
  REVIEW_MODERATE: "REVIEW_MODERATE",
  COUPON_MANAGE: "COUPON_MANAGE",
  SUPER_ADMIN: "*",
} as const;

const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? "";
const BCRYPT_COST = 12;

const ROLE_DEFS = [
  {
    name: "SUPER_ADMIN",
    description: "Full platform access",
    permissions: [PERMISSIONS.SUPER_ADMIN],
  },
  {
    name: "Catalog Manager",
    description: "Manage catalog, inventory, and media",
    permissions: [
      PERMISSIONS.PRODUCT_VIEW,
      PERMISSIONS.PRODUCT_CREATE,
      PERMISSIONS.PRODUCT_UPDATE,
      PERMISSIONS.PRODUCT_DELETE,
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.INVENTORY_UPDATE,
      PERMISSIONS.MEDIA_MANAGE,
      PERMISSIONS.COUPON_MANAGE,
    ],
  },
  {
    name: "Order Manager",
    description: "Manage orders, customers, and fulfillment",
    permissions: [
      PERMISSIONS.ORDER_VIEW,
      PERMISSIONS.ORDER_UPDATE,
      PERMISSIONS.ORDER_CANCEL,
      PERMISSIONS.ORDER_REFUND,
      PERMISSIONS.CUSTOMER_VIEW,
      PERMISSIONS.CUSTOMER_UPDATE,
      PERMISSIONS.REPORT_VIEW,
    ],
  },
  {
    name: "Delivery Partner",
    description: "3rd-party local dispatch — last-mile status, attempts, and COD only",
    permissions: [PERMISSIONS.DISPATCH],
  },
] as const;

const ADMIN_USERS = [
  { email: "admin@avyora.com", name: "Atelier Admin", roleName: "SUPER_ADMIN" },
  { email: "catalog@avyora.com", name: "Catalog Manager", roleName: "Catalog Manager" },
  { email: "orders@avyora.com", name: "Order Manager", roleName: "Order Manager" },
  { email: "dispatch@avyora.com", name: "Local Dispatch Partner", roleName: "Delivery Partner" },
] as const;

const CUSTOMER_GROUPS = [
  { legacyId: "g-regular", name: "Regular", discountPercent: 0, benefits: "Standard checkout and 15-day exchange." },
  { legacyId: "g-premium", name: "Premium", discountPercent: 5, benefits: "Priority resizing and atelier appointments." },
  { legacyId: "g-vip", name: "VIP", discountPercent: 10, benefits: "Private viewing and complimentary cleaning." },
  { legacyId: "g-wholesale", name: "Wholesale", discountPercent: 15, benefits: "Trade pricing on selected SKUs." },
] as const;

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
    case "published":
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

async function upsertPermissions(): Promise<Map<string, string>> {
  const codes = Object.values(PERMISSIONS).filter((code) => code !== PERMISSIONS.SUPER_ADMIN);
  const permissionIds = new Map<string, string>();

  for (const code of codes) {
    const permission = await prisma.permission.upsert({
      where: { code },
      create: { code, description: code.replace(/_/g, " ").toLowerCase() },
      update: {},
    });
    permissionIds.set(code, permission.id);
  }

  const superAdmin = await prisma.permission.upsert({
    where: { code: PERMISSIONS.SUPER_ADMIN },
    create: { code: PERMISSIONS.SUPER_ADMIN, description: "Full administrative access" },
    update: {},
  });
  permissionIds.set(PERMISSIONS.SUPER_ADMIN, superAdmin.id);

  return permissionIds;
}

async function seedRoles(permissionIds: Map<string, string>): Promise<Map<string, string>> {
  const roleIds = new Map<string, string>();

  for (const roleDef of ROLE_DEFS) {
    const role = await prisma.role.upsert({
      where: { name: roleDef.name },
      create: { name: roleDef.name, description: roleDef.description },
      update: { description: roleDef.description },
    });
    roleIds.set(roleDef.name, role.id);

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

    for (const code of roleDef.permissions) {
      const permissionId = permissionIds.get(code);
      if (!permissionId) continue;
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId },
      });
    }
  }

  return roleIds;
}

async function seedAdminUsers(roleIds: Map<string, string>, passwordHash: string) {
  for (const admin of ADMIN_USERS) {
    const roleId = roleIds.get(admin.roleName);
    if (!roleId) {
      throw new Error(`Missing role: ${admin.roleName}`);
    }

    const user = await prisma.user.upsert({
      where: { email: admin.email },
      create: {
        email: admin.email,
        name: admin.name,
        passwordHash,
        role: UserRole.ADMIN,
        active: true,
      },
      update: {
        name: admin.name,
        passwordHash,
        role: UserRole.ADMIN,
        active: true,
      },
    });

    await prisma.adminUser.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        roleId,
        legacyId: admin.email.split("@")[0],
      },
      update: { roleId },
    });
  }
}

async function seedCustomerGroups() {
  for (const group of CUSTOMER_GROUPS) {
    await prisma.customerGroup.upsert({
      where: { legacyId: group.legacyId },
      create: {
        legacyId: group.legacyId,
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
  }
}

async function seedWarehouse() {
  return prisma.warehouse.upsert({
    where: { code: "MAIN" },
    create: {
      code: "MAIN",
      name: "Main Warehouse",
      isDefault: true,
      active: true,
    },
    update: {
      name: "Main Warehouse",
      isDefault: true,
      active: true,
    },
  });
}

async function seedBrand(name: string) {
  const slug = slugify(name);
  return prisma.brand.upsert({
    where: { slug },
    create: { name, slug, legacyId: `br-${slug}` },
    update: { name },
  });
}

async function seedCategory(name: string) {
  const slug = slugify(name);
  return prisma.category.upsert({
    where: { slug },
    create: { name, slug, legacyId: `cat-${slug}` },
    update: { name },
  });
}

async function seedProduct(product: Product, warehouseId: string) {
  const brand = await seedBrand(product.brand);
  const category = await seedCategory(product.category);

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
      shortDescription: product.shortDescription,
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
      searchable: product.searchable ?? true,
      spinEnabled: product.spinEnabled,
      lifestyleImage: product.lifestyleImage,
      minStock: product.minStock ?? 0,
      status: mapProductStatus(product.status),
      rating: product.rating,
      reviewCount: product.reviewCount,
    },
    update: {
      sku: product.sku,
      slug: product.slug,
      name: product.name,
      brandId: brand.id,
      categoryId: category.id,
      collectionSlug: product.collection,
      tags: product.tags,
      description: product.description,
      status: mapProductStatus(product.status),
      rating: product.rating,
      reviewCount: product.reviewCount,
    },
  });

  await prisma.productImage.deleteMany({ where: { productId: dbProduct.id } });
  if (product.images.length) {
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
        productId: dbProduct.id,
        size: variant.size,
        metal: variant.metal,
        purity: variant.purity,
        colour: variant.colour,
        stock: variant.stock,
        price: variant.price,
        salePrice: variant.salePrice,
      },
    });

    await prisma.inventory.upsert({
      where: {
        warehouseId_variantId: {
          warehouseId,
          variantId: dbVariant.id,
        },
      },
      create: {
        warehouseId,
        productId: dbProduct.id,
        variantId: dbVariant.id,
        quantity: variant.stock,
      },
      update: {
        quantity: variant.stock,
      },
    });
  }

  return dbProduct;
}

async function seedCollections() {
  const productsBySlug = await prisma.product.findMany({
    select: { id: true, slug: true },
  });
  const slugToId = new Map(productsBySlug.map((p) => [p.slug, p.id]));

  for (const collection of collections) {
    const dbCollection = await prisma.collection.upsert({
      where: { slug: collection.slug },
      create: {
        slug: collection.slug,
        name: collection.name,
        tagline: collection.tagline,
        description: collection.description,
        image: collection.image,
      },
      update: {
        name: collection.name,
        tagline: collection.tagline,
        description: collection.description,
        image: collection.image,
      },
    });

    await prisma.collectionProduct.deleteMany({ where: { collectionId: dbCollection.id } });

    const links = collection.productSlugs
      .map((slug, index) => {
        const productId = slugToId.get(slug);
        if (!productId) return null;
        return { collectionId: dbCollection.id, productId, sortOrder: index };
      })
      .filter((entry): entry is { collectionId: string; productId: string; sortOrder: number } => Boolean(entry));

    if (links.length) {
      await prisma.collectionProduct.createMany({ data: links, skipDuplicates: true });
    }
  }
}

async function seedCoupons() {
  for (const coupon of coupons) {
    await prisma.coupon.upsert({
      where: { code: coupon.code },
      create: {
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
      },
    });
  }
}

async function seedShippingMethods() {
  const methods = [
    {
      legacyId: "ship-std",
      name: "Insured standard",
      charge: 199,
      freeAbove: 7999,
      eta: "3–7 working days",
    },
    {
      legacyId: "ship-exp",
      name: "Express metro",
      charge: 499,
      freeAbove: 25000,
      eta: "1–3 working days",
    },
  ] as const;

  for (const method of methods) {
    await prisma.shippingMethod.upsert({
      where: { legacyId: method.legacyId },
      create: {
        legacyId: method.legacyId,
        name: method.name,
        charge: method.charge,
        freeAbove: method.freeAbove,
        eta: method.eta,
        active: true,
      },
      update: {
        name: method.name,
        charge: method.charge,
        freeAbove: method.freeAbove,
        eta: method.eta,
        active: true,
      },
    });
  }
}

async function main() {
  console.info("[seed] Starting Avyora database seed…");

  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
    throw new Error(
      "[seed] ADMIN_SEED_PASSWORD env var (min 8 characters) is required. Never hardcode staff passwords.",
    );
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_COST);
  // Always refresh roles/permissions/staff so new portal roles (e.g. DISPATCH) land on existing DBs.
  const permissionIds = await upsertPermissions();
  const roleIds = await seedRoles(permissionIds);
  await seedAdminUsers(roleIds, passwordHash);
  console.info(`[seed] Staff roles/users upserted (${ADMIN_USERS.length} accounts).`);

  const productCount = await prisma.product.count();
  if (productCount > 0 && process.env.SEED_FORCE !== "true") {
    console.info(
      `[seed] Database already has ${productCount} products — skipping catalog/stock upserts.`,
    );
    console.info("[seed] Set SEED_FORCE=true only for intentional empty-DB re-seed (destructive to catalog upserts).");
    return;
  }

  await seedCustomerGroups();
  const warehouse = await seedWarehouse();

  for (const product of products) {
    await seedProduct(product, warehouse.id);
  }

  await seedCollections();
  await seedCoupons();
  await seedShippingMethods();

  console.info("[seed] Completed successfully.");
  console.info(`  Products: ${products.length}`);
  console.info(`  Collections: ${collections.length}`);
  console.info(`  Coupons: ${coupons.length}`);
  console.info(`  Admin users: ${ADMIN_USERS.length}`);
}

main()
  .catch((error) => {
    console.error("[seed] Failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export default main;
