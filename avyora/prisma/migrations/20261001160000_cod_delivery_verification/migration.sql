-- CreateEnum
CREATE TYPE "CodCollectionMethod" AS ENUM ('CASH', 'UPI');

-- CreateTable
CREATE TABLE "cod_delivery_verifications" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpSentAt" TIMESTAMP(3),
    "otpVerifiedAt" TIMESTAMP(3),
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "collectionMethod" "CodCollectionMethod",
    "cashCollectedAt" TIMESTAMP(3),
    "cashCollectedBy" TEXT,
    "upiPaymentId" TEXT,
    "upiProviderOrderId" TEXT,
    "upiProviderPaymentId" TEXT,
    "upiVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cod_delivery_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cod_delivery_verifications_orderId_key" ON "cod_delivery_verifications"("orderId");

-- CreateIndex
CREATE INDEX "cod_delivery_verifications_otpExpiresAt_idx" ON "cod_delivery_verifications"("otpExpiresAt");

-- AddForeignKey
ALTER TABLE "cod_delivery_verifications" ADD CONSTRAINT "cod_delivery_verifications_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
