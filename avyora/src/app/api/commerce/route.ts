import { hasAnyPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest, type AuthContext } from "@/server/auth/rbac";
import { withStaffCustomers } from "@/server/customers/load-customers";
import { withStaffOrders } from "@/server/orders/load-orders";
import { loadCommerce, mutateCommerce, type CommerceSnapshot } from "@/server/commerce-db";
import {
  syncCatalogStockToPostgres,
  withLiveCatalogStock,
} from "@/server/inventory/sync-catalog-stock";
import { assertSecureRuntimeConfig, isLegacyCommerceWriteEnabled } from "@/server/security/runtime-config";
import {
  mirrorInventoryDisplayFromPostgres,
  refreshTransactionalMirror,
} from "@/server/sot-transactional";
import {
  clientAttemptedTransactionalOverwrite,
  getSotStatus,
  isJsonStockPushToPostgresEnabled,
  sanitizeCommerceWrite,
} from "@/server/sot/transactional";
import { logger } from "@/server/logger";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

try {
  assertSecureRuntimeConfig();
} catch (error) {
  console.error(error);
}

type PublicCommerceSnapshot = {
  scope: "public";
  catalog: CommerceSnapshot["catalog"];
  collections: CommerceSnapshot["collections"];
  coupons: CommerceSnapshot["coupons"];
  campaigns: CommerceSnapshot["campaigns"];
  mediaUrls: CommerceSnapshot["mediaUrls"];
  ops?: Pick<
    CommerceSnapshot["ops"],
    | "shippingMethods"
    | "paymentMethods"
    | "settings"
    | "banners"
    | "homepageSections"
    | "categories"
    | "menus"
    | "brands"
  >;
  updatedAt?: string;
};

type StaffCommerceSnapshot = CommerceSnapshot & { scope: "staff" };

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function canReadStaffCommerce(session: AuthContext | null): session is AuthContext {
  if (!session) return false;
  return hasAnyPermission(session.permissions, [
    PERMISSIONS.ORDER_VIEW,
    PERMISSIONS.ORDER_UPDATE,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.PRODUCT_VIEW,
    PERMISSIONS.INVENTORY_VIEW,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.SETTINGS_MANAGE,
  ]);
}

function canWriteCommerce(session: AuthContext | null): session is AuthContext {
  if (!session) return false;
  return hasAnyPermission(session.permissions, [
    PERMISSIONS.PRODUCT_CREATE,
    PERMISSIONS.PRODUCT_UPDATE,
    PERMISSIONS.PRODUCT_DELETE,
    PERMISSIONS.COUPON_MANAGE,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.MEDIA_MANAGE,
  ]);
}

function stripCustomerSecrets(snapshot: CommerceSnapshot): CommerceSnapshot {
  return {
    ...snapshot,
    customers: snapshot.customers.map((c) => ({
      ...c,
      password: undefined,
      resetToken: undefined,
      resetExpiresAt: undefined,
    })),
  };
}

function toPublicSnapshot(snapshot: CommerceSnapshot): PublicCommerceSnapshot {
  return {
    scope: "public",
    catalog: snapshot.catalog,
    collections: snapshot.collections,
    coupons: snapshot.coupons,
    campaigns: snapshot.campaigns,
    mediaUrls: snapshot.mediaUrls,
    // Storefront needs shipping/payment plus homepage banners/sections (no secrets).
    ops: {
      shippingMethods: snapshot.ops?.shippingMethods ?? [],
      paymentMethods: snapshot.ops?.paymentMethods ?? [],
      settings: snapshot.ops?.settings,
      banners: snapshot.ops?.banners ?? [],
      homepageSections: snapshot.ops?.homepageSections ?? [],
      categories: snapshot.ops?.categories ?? [],
      menus: snapshot.ops?.menus ?? [],
      brands: snapshot.ops?.brands ?? [],
    },
    updatedAt: snapshot.updatedAt,
  };
}

function toStaffSnapshot(snapshot: CommerceSnapshot): StaffCommerceSnapshot {
  return {
    ...stripCustomerSecrets(snapshot),
    scope: "staff",
  };
}

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  // Always show Postgres stock on catalog (matches checkout).
  const snapshot = await withLiveCatalogStock(loadCommerce());
  const staff = canReadStaffCommerce(session);
  let enriched = snapshot;
  if (staff) {
    // Orders/customers always from Postgres when DB is healthy.
    enriched = await withStaffCustomers(snapshot);
    enriched = await withStaffOrders(enriched);
  }
  const body = staff ? toStaffSnapshot(enriched) : toPublicSnapshot(snapshot);

  return NextResponse.json(
    { ...body, sot: getSotStatus() },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}

/**
 * Staff commerce save for catalog/ops only.
 * PostgreSQL remains SoT for orders, customers, payments, and inventory.
 * - Client orders/customers are ignored
 * - JSON stock does not push into Postgres (unless emergency opt-in)
 * - After save, catalog display stock is pulled FROM Postgres
 */
export async function PUT(request: Request) {
  const session = await getSessionFromRequest(request);

  if (!canWriteCommerce(session)) {
    if (!isLegacyCommerceWriteEnabled()) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Staff authentication required for commerce writes. Sign in again at /staff-login.",
          },
        },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Staff JWT required. ALLOW_LEGACY_COMMERCE_WRITE no longer grants write access.",
        },
      },
      { status: 401 },
    );
  }

  const body = (await request.json()) as Partial<CommerceSnapshot>;
  const current = loadCommerce();
  const next = sanitizeCommerceWrite(body, current);
  const rejectedTransactional = clientAttemptedTransactionalOverwrite(body);

  const catalogChanged =
    body.catalog !== undefined && stableJson(body.catalog) !== stableJson(current.catalog);
  const changed = stableJson(next) !== stableJson(current);

  if (!changed && !catalogChanged) {
    return NextResponse.json({
      ok: true,
      unchanged: true,
      updatedAt: current.updatedAt,
      sot: getSotStatus(),
      rejectedTransactionalOverwrite: rejectedTransactional,
    });
  }

  // Emergency-only reverse sync. Default path never lets JSON overwrite Postgres stock.
  let stockPushed = 0;
  if (body.catalog !== undefined && isJsonStockPushToPostgresEnabled()) {
    try {
      stockPushed = await syncCatalogStockToPostgres(next, session.email, {
        mirrorToCommerceJson: false,
      });
      if (stockPushed > 0) {
        logger.warn("commerce.put.emergency_json_stock_push", {
          updated: stockPushed,
          actor: session.email,
        });
      }
    } catch (error) {
      logger.error("commerce.put.stock_sync_failed", { error: String(error) });
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "STOCK_SYNC_FAILED",
            message:
              "Emergency JSON→Postgres stock push failed. Catalog was not saved.",
          },
          sot: getSotStatus(),
        },
        { status: 502 },
      );
    }
  }

  const saved = await mutateCommerce((fresh) => sanitizeCommerceWrite(body, fresh));

  // Postgres → JSON: refresh transactional mirror + catalog stock display.
  const mirrored = await refreshTransactionalMirror();
  try {
    await mirrorInventoryDisplayFromPostgres();
  } catch (error) {
    logger.warn("commerce.put.inventory_display_mirror_failed", { error: String(error) });
  }

  return NextResponse.json({
    ok: true,
    updatedAt: mirrored.updatedAt ?? saved.updatedAt,
    sot: getSotStatus(),
    rejectedTransactionalOverwrite: rejectedTransactional,
    jsonStockPushedToPostgres: stockPushed,
  });
}
