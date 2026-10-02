/**
 * Clears testing / audit operational data.
 * Keeps: catalogue, collections, coupons, staff accounts, roles, CMS ops settings.
 */
import { PrismaClient, UserRole } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();
const commercePath = path.join(process.cwd(), "data", "commerce.json");
const backupPath = `${commercePath}.pre-clear.bak`;

function clearCommerceJson() {
  if (!fs.existsSync(commercePath)) {
    console.log("commerce.json: missing — skip");
    return;
  }
  fs.copyFileSync(commercePath, backupPath);
  const raw = JSON.parse(fs.readFileSync(commercePath, "utf8"));
  const next = {
    ...raw,
    customers: [],
    orders: [],
    appointments: [],
    audit: [],
    mediaUrls: [],
    ops: {
      ...(raw.ops ?? {}),
      stockMoves: [],
      searches: [],
      visits: [],
    },
    updatedAt: new Date().toISOString(),
  };
  const tmp = `${commercePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.copyFileSync(tmp, commercePath);
  fs.unlinkSync(tmp);
  console.log("commerce.json: cleared orders/customers/appointments/audit/searches/visits/stockMoves");
  console.log(`commerce.json: backup at ${path.basename(backupPath)}`);
}

async function clearPostgres() {
  // Delete in dependency-safe order for operational/test tables.
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["payment_events", () => prisma.paymentEvent.deleteMany()],
    ["refunds", () => prisma.refund.deleteMany()],
    ["payments", () => prisma.payment.deleteMany()],
    ["shipments", () => prisma.shipment.deleteMany()],
    ["returns", () => prisma.return.deleteMany()],
    ["order_status_history", () => prisma.orderStatusHistory.deleteMany()],
    ["order_items", () => prisma.orderItem.deleteMany()],
    ["orders", () => prisma.order.deleteMany()],
    ["review_votes", () => prisma.reviewVote.deleteMany()],
    ["review_images", () => prisma.reviewImage.deleteMany()],
    ["reviews", () => prisma.review.deleteMany()],
    ["cart_items", () => prisma.cartItem.deleteMany()],
    ["carts", () => prisma.cart.deleteMany()],
    ["abandoned_carts", () => prisma.abandonedCart.deleteMany()],
    ["wishlist_items", () => prisma.wishlistItem.deleteMany()],
    ["addresses", () => prisma.address.deleteMany()],
    ["certificates", () => prisma.certificate.deleteMany()],
    ["repair_requests", () => prisma.repairRequest.deleteMany()],
    ["loyalty_transactions", () => prisma.loyaltyTransaction.deleteMany()],
    ["referrals", () => prisma.referral.deleteMany()],
    ["loyalty_accounts", () => prisma.loyaltyAccount.deleteMany()],
    ["stock_movements", () => prisma.stockMovement.deleteMany()],
    ["notification_logs", () => prisma.notificationLog.deleteMany()],
    ["audit_logs", () => prisma.auditLog.deleteMany()],
    ["password_reset_tokens", () => prisma.passwordResetToken.deleteMany()],
    ["recommendation_cache", () => prisma.recommendationCache.deleteMany()],
    ["refresh_tokens", () => prisma.refreshToken.deleteMany({ where: { user: { role: UserRole.CUSTOMER } } })],
    ["customers", () => prisma.customer.deleteMany()],
    ["customer_users", () => prisma.user.deleteMany({ where: { role: UserRole.CUSTOMER } })],
  ];

  for (const [label, run] of steps) {
    try {
      const result = (await run()) as { count?: number };
      console.log(`postgres ${label}: deleted ${result.count ?? 0}`);
    } catch (error) {
      console.log(`postgres ${label}: skip (${error instanceof Error ? error.message : "error"})`);
    }
  }
}

async function main() {
  console.log("Clearing test/audit operational data…");
  clearCommerceJson();
  try {
    await clearPostgres();
  } catch (error) {
    console.error("Postgres clear failed:", error instanceof Error ? error.message : error);
    console.error("commerce.json was still cleared. Check DATABASE_URL / Postgres.");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
  console.log("Done. Catalogue, collections, coupons, and staff accounts kept.");
}

main();
