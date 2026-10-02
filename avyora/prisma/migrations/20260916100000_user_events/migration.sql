-- Personalized recommendation behavioral events
CREATE TYPE "UserEventType" AS ENUM (
  'PRODUCT_VIEW',
  'PRODUCT_CLICK',
  'SEARCH',
  'ADD_TO_CART',
  'REMOVE_FROM_CART',
  'WISHLIST_ADD',
  'WISHLIST_REMOVE',
  'PURCHASE',
  'RECOMMENDATION_IMPRESSION',
  'RECOMMENDATION_CLICK'
);

CREATE TABLE "user_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "anonId" TEXT,
    "eventType" "UserEventType" NOT NULL,
    "productId" TEXT,
    "categoryId" TEXT,
    "searchQuery" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_events_userId_createdAt_idx" ON "user_events"("userId", "createdAt");
CREATE INDEX "user_events_anonId_createdAt_idx" ON "user_events"("anonId", "createdAt");
CREATE INDEX "user_events_eventType_createdAt_idx" ON "user_events"("eventType", "createdAt");
CREATE INDEX "user_events_productId_createdAt_idx" ON "user_events"("productId", "createdAt");
CREATE INDEX "user_events_categoryId_createdAt_idx" ON "user_events"("categoryId", "createdAt");

ALTER TABLE "user_events" ADD CONSTRAINT "user_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
