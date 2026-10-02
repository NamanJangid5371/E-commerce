-- AlterTable
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_deliveredAt_idx" ON "orders"("deliveredAt");
CREATE INDEX IF NOT EXISTS "order_items_deliveredAt_idx" ON "order_items"("deliveredAt");

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ReturnRequestStatus" AS ENUM (
    'RETURN_REQUESTED',
    'RETURN_APPROVED',
    'PICKUP_SCHEDULED',
    'PICKED_UP',
    'IN_TRANSIT',
    'RECEIVED_AT_WAREHOUSE',
    'INSPECTION_PENDING',
    'INSPECTION_APPROVED',
    'REFUND_ELIGIBLE',
    'REFUND_INITIATED',
    'REFUND_COMPLETED',
    'RETURN_REJECTED',
    'RETURN_CANCELLED',
    'INSPECTION_REJECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "return_requests" (
    "id" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "customerId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ReturnRequestStatus" NOT NULL DEFAULT 'RETURN_REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "pickupScheduledAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "inTransitAt" TIMESTAMP(3),
    "warehouseReceivedAt" TIMESTAMP(3),
    "inspectionAt" TIMESTAMP(3),
    "refundEligibleAt" TIMESTAMP(3),
    "refundInitiatedAt" TIMESTAMP(3),
    "refundCompletedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "productVerified" BOOLEAN NOT NULL DEFAULT false,
    "productVerifiedAt" TIMESTAMP(3),
    "productVerifiedBy" TEXT,
    "inspectionNotes" TEXT,
    "inspectionBy" TEXT,
    "rejectReason" TEXT,
    "pickupNote" TEXT,
    "trackingNumber" TEXT,
    "courier" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "return_status_events" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "status" "ReturnRequestStatus" NOT NULL,
    "note" TEXT,
    "actorEmail" TEXT,
    "actorRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_status_events_pkey" PRIMARY KEY ("id")
);

-- AlterTable Refunds
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "returnRequestId" TEXT;
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "method" TEXT;
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "initiatedAt" TIMESTAMP(3);
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "return_requests_returnNumber_key" ON "return_requests"("returnNumber");
CREATE INDEX IF NOT EXISTS "return_requests_orderId_idx" ON "return_requests"("orderId");
CREATE INDEX IF NOT EXISTS "return_requests_orderItemId_idx" ON "return_requests"("orderItemId");
CREATE INDEX IF NOT EXISTS "return_requests_customerId_idx" ON "return_requests"("customerId");
CREATE INDEX IF NOT EXISTS "return_requests_status_idx" ON "return_requests"("status");
CREATE INDEX IF NOT EXISTS "return_requests_requestedAt_idx" ON "return_requests"("requestedAt");
CREATE INDEX IF NOT EXISTS "return_status_events_returnRequestId_idx" ON "return_status_events"("returnRequestId");
CREATE INDEX IF NOT EXISTS "return_status_events_createdAt_idx" ON "return_status_events"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_returnRequestId_key" ON "refunds"("returnRequestId");
CREATE INDEX IF NOT EXISTS "refunds_status_idx" ON "refunds"("status");

-- Backfill deliveredAt from status history where missing
UPDATE "orders" o
SET "deliveredAt" = h."createdAt"
FROM (
  SELECT DISTINCT ON ("orderId") "orderId", "createdAt"
  FROM "order_status_history"
  WHERE "status" = 'DELIVERED'
  ORDER BY "orderId", "createdAt" ASC
) h
WHERE o.id = h."orderId" AND o."deliveredAt" IS NULL;

UPDATE "order_items" oi
SET "deliveredAt" = o."deliveredAt"
FROM "orders" o
WHERE oi."orderId" = o.id AND oi."deliveredAt" IS NULL AND o."deliveredAt" IS NOT NULL;

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_orderItemId_fkey"
    FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "return_status_events" ADD CONSTRAINT "return_status_events_returnRequestId_fkey"
    FOREIGN KEY ("returnRequestId") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_returnRequestId_fkey"
    FOREIGN KEY ("returnRequestId") REFERENCES "return_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
