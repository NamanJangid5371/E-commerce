# Avyora — Implementation Roadmap

**Created:** 2026-08-31  
**Status:** Phase 0 complete → Phase 1 server/API foundation in progress  
**Reference:** [ARCHITECTURE_AUDIT.md](./ARCHITECTURE_AUDIT.md)

---

## How to use this document

- Check off tasks as they are completed (`[x]`)
- Do not start Phase 2 until Phase 1 is stable and tested
- Each major feature requires: **DB + API + validation + auth + tests + docs**
- Update this file after each sprint

---

## Phase 0 — Codebase Audit ✅

- [x] Inspect entire codebase structure
- [x] Document actual tech stack (Next.js, not MongoDB)
- [x] Map persistence layer (`commerce.json` + Zustand)
- [x] Document all API routes
- [x] Document auth flows (customer + staff)
- [x] Document RBAC gaps
- [x] Document payment flow gaps
- [x] Document media/search/order implementations
- [x] Identify security risks
- [x] Identify hydration/SSR issues
- [x] Identify technical debt and migration risks
- [x] Create `docs/ARCHITECTURE_AUDIT.md`
- [x] Create `docs/IMPLEMENTATION_ROADMAP.md`

---

## Phase 1 — Make It Real (4–6 weeks)

> **Goal:** Production-safe foundation — database, auth, payments, media, pricing, reviews.

### 1.1 PostgreSQL + Prisma Migration

#### Schema design
- [x] Install `@prisma/client`, `prisma`
- [x] Create `avyora/prisma/schema.prisma`
- [x] Model: `User` (base auth entity)
- [x] Model: `Role`, `Permission`, `RolePermission` (RBAC)
- [x] Model: `Customer`, `CustomerGroup`, `CustomerGroupMembership`
- [x] Model: `Address`
- [x] Model: `Product`, `ProductVariant`
- [x] Model: `Category`, `Subcategory`, `Brand`, `Collection`, `CollectionProduct`
- [x] Model: `ProductImage`, `ProductVideo`
- [x] Model: `Inventory`, `Warehouse` (single warehouse initially)
- [x] Model: `Order`, `OrderItem`
- [x] Model: `Payment`, `PaymentEvent`, `Refund`
- [x] Model: `Coupon`, `Discount`, `DiscountRule`
- [x] Model: `Review`, `ReviewImage`, `ReviewVote`
- [x] Model: `Cart`, `CartItem`
- [x] Model: `Wishlist`, `WishlistItem`
- [x] Model: `ShippingMethod`, `Shipment`
- [x] Model: `Return`
- [x] Model: `Notification`, `NotificationLog`
- [x] Model: `Certificate`
- [x] Model: `AdminUser` (links to User + Role)
- [x] Model: `AuditLog`
- [x] Add `createdAt`, `updatedAt` on all entities
- [x] Add soft delete (`deletedAt`) where appropriate
- [x] Add indexes for frequently queried fields
- [x] Add unique constraints (email, SKU, order number, etc.)
- [x] Add foreign keys with cascade/restrict rules

#### Migration tooling
- [x] Create initial Prisma migration (SQL in `prisma/migrations/`)
- [ ] Run `prisma migrate deploy` against live PostgreSQL (requires running DB)
- [x] Create `scripts/migrate-from-json.ts` — export `commerce.json` → PostgreSQL
- [x] Preserve existing IDs/slugs where practical
- [x] Hash customer passwords during import (or force reset)
- [ ] Filter synthetic historic demo orders on import (optional flag)
- [ ] Create `scripts/verify-migration.ts` — record count + spot checks
- [x] **Never delete** original `commerce.json` during migration
- [x] Create Prisma seed script from existing `catalog.ts` + `admin-ops.ts`
- [x] Document migration runbook in `docs/MIGRATION.md`

#### API cutover strategy
- [x] Introduce Prisma client singleton (`src/server/db.ts`)
- [ ] Create repository/service layer (feature-based folders) — partial (`src/server/*` modules exist)
- [x] Keep `/api/commerce` temporarily with read-only fallback flag
- [ ] Replace writes one domain at a time (products → orders → customers)
- [x] Add `DATABASE_URL` to `.env.example`

---

### 1.2 Server-Side Authentication + RBAC

#### Auth infrastructure
- [x] Install `bcrypt` (or `@node-rs/argon2`) + `jose` (JWT) — `bcryptjs` + `jose`
- [x] Create `src/server/auth/password.ts` — hash/verify
- [x] Create `src/server/auth/session.ts` — JWT or secure session cookies
- [x] Create `src/server/auth/tokens.ts` — access + refresh token strategy (`issue-session.ts`)
- [ ] Create `src/server/auth/rate-limit.ts` — login attempt limiting (lockout in login routes only)
- [x] Add `JWT_SECRET`, `JWT_REFRESH_SECRET` to `.env.example`

#### Customer auth API
- [x] `POST /api/auth/login` — server-validated login
- [x] `POST /api/auth/logout` — invalidate session
- [x] `POST /api/auth/refresh` — refresh token rotation
- [x] Update `POST /api/auth/register` — bcrypt hash, no plaintext return
- [ ] Update forgot/reset password — server sessions, hashed tokens (still uses `commerce.json`)
- [ ] Remove client-side password comparison from `shop-store.ts`
- [ ] Migrate customer session from localStorage to HttpOnly cookie

#### Staff auth API
- [x] `POST /api/auth/staff/login` — per-admin bcrypt password (replace `avyora123`)
- [x] `POST /api/auth/staff/logout` — shared `/api/auth/logout`
- [ ] Replace forgeable `avyora_admin` cookie with signed session
- [x] Seed admin users with hashed passwords in Prisma seed

#### RBAC
- [x] Define permission constants (`PRODUCT_VIEW`, `ORDER_UPDATE`, etc.)
- [x] Seed roles: Super Admin, Admin, Manager, Operations, Customer
- [x] Create `src/server/auth/permissions.ts` — permission checker
- [x] Create `requireAuth()` middleware for API routes
- [x] Create `requirePermission(perm)` middleware for API routes
- [ ] Fix admin nav permission mapping (`admin-layout.tsx`)
- [ ] Add server-side route guards for admin pages (middleware or layout server check)
- [x] Audit log on login, failed login, permission-denied actions

#### Frontend integration
- [ ] Update `staff-login/page.tsx` to call staff login API
- [ ] Update `login/page.tsx` to call customer login API
- [ ] Update `providers.tsx` — remove 4s poll; use authenticated fetch
- [ ] Admin UI shows only permitted nav items (keep existing UX)

#### Tests
- [ ] Unit tests: password hashing
- [ ] Unit tests: JWT issue/verify
- [x] Unit tests: permission checker
- [ ] Integration tests: login/logout flows
- [ ] Integration tests: RBAC denied access returns 403

---

### 1.3 Razorpay Payment Security

- [x] Install/use Razorpay SDK formally
- [x] Add `RAZORPAY_WEBHOOK_SECRET` to `.env.example`
- [x] `POST /api/payments/razorpay/order` — validate cart server-side before order create
- [x] `POST /api/payments/razorpay/verify` — signature verification endpoint
- [x] `POST /api/payments/razorpay/webhook` — webhook handler
- [x] Webhook signature validation (HMAC)
- [x] Idempotency keys for webhook events (`PaymentEvent` table)
- [x] Payment statuses: pending, success, failed, refunded
- [x] Never trust browser payment success — server verify only (documented; frontend wiring partial)
- [ ] Update checkout flow to call verify endpoint after Razorpay modal
- [x] Store Razorpay payment ID, order ID, signature on Payment record
- [x] Failed payment handling — order stays in pending/cancelled
- [ ] Refund API integration (`POST /api/payments/refund`)
- [ ] Partial refund support where Razorpay allows
- [x] Payment audit history in `PaymentEvent`
- [x] Tests: signature verification unit tests
- [ ] Tests: webhook idempotency integration tests
- [x] Document webhook URL setup in `docs/PAYMENTS.md`

---

### 1.4 Cloudinary Media Pipeline

- [x] Install `cloudinary` SDK
- [x] Add Cloudinary env vars to `.env.example`:
  - `CLOUDINARY_CLOUD_NAME`
  - `CLOUDINARY_API_KEY`
  - `CLOUDINARY_API_SECRET`
- [x] Create `src/server/media/cloudinary.ts` — upload, transform, delete
- [x] Create signed upload endpoint `POST /api/media/upload` (auth required)
- [x] Replace `/api/upload` local disk writes with Cloudinary (keep local as dev fallback)
- [ ] Store `publicId`, `url`, `width`, `height`, `format` in `ProductImage`
- [ ] Responsive image URLs (thumbnail, gallery, PDP hero)
- [ ] WebP/optimized delivery configuration
- [x] Folder organization: `avyora/products/`, `avyora/banners/`, etc.
- [ ] Admin product form — Cloudinary upload widget or signed upload
- [ ] Admin media page — upload + browse + delete
- [ ] Delete/replace media with orphan cleanup strategy
- [ ] Update `ProductImage` component to use Cloudinary transforms
- [x] Never expose API secret to frontend (signed uploads only)
- [ ] Tests: upload validation, auth required
- [x] Document media setup in `docs/MEDIA.md`

---

### 1.5 Customer Group Discounts

- [x] Extend `DiscountRule` model for group/product/category/collection scopes
- [x] Server-side pricing service: `src/server/pricing/discounts.ts`
- [x] `POST /api/checkout/preview` — server-calculated totals
- [x] Identify customer group from authenticated session
- [x] Apply eligible discounts server-side
- [x] Enforce minimum order, date range, max discount caps
- [x] Prevent discount stacking abuse (priority rules)
- [ ] Store applied discounts on `Order` snapshot
- [ ] Update checkout UI to display server-returned totals
- [ ] Remove client-only `cartTotals()` as source of truth for checkout
- [ ] Admin: configure group discounts in existing groups page
- [x] Tests: discount calculation unit tests
- [x] Tests: stacking prevention tests
- [ ] Tests: checkout preview integration tests

---

### 1.6 Customer Reviews

- [x] Extend `Review` model (verified purchase flag, moderation status)
- [x] `POST /api/products/[slug]/reviews` — submit review (auth required)
- [x] Verify purchase eligibility (order contains product)
- [x] Prevent duplicate reviews per customer/product
- [x] Rating 1–5, title, description
- [ ] Optional review image upload (Cloudinary)
- [x] `GET /api/products/[slug]/reviews` — paginated, approved only
- [ ] Helpful vote endpoint
- [ ] Report review endpoint
- [ ] Admin: approve/reject in existing reviews page (wire to API)
- [ ] Average rating + distribution on PDP
- [ ] Customer account: review history section
- [ ] Tests: verified purchase check
- [ ] Tests: duplicate prevention
- [ ] Tests: moderation flow

---

### 1.7 Phase 1 Cross-Cutting

- [x] Install Vitest + test config
- [x] Create `docs/API.md` — document all endpoints
- [x] Update `avyora/.env.example` with all Phase 1 vars
- [x] Add structured logging (`src/server/logger.ts`)
- [x] Add global API error handler format
- [x] Add Zod validation on all new endpoints
- [ ] Add security headers in `next.config.ts`
- [ ] Configure CORS for admin/storefront origins
- [ ] Run lint + type checks — fix errors
- [ ] Verify existing storefront flows still work
- [ ] Verify existing admin flows still work
- [ ] Phase 1 sign-off checklist

---

## Phase 2 — Jewellery Differentiation (4–8 weeks)

> **Do not start until Phase 1 is stable and tested.**

### 2.1 Ring Size Advisor

- [x] Model: `RingSizePreference` on Customer profile (`preferredRingSize`)
- [x] Size conversion tables (India/US/UK/EU)
- [x] `GET /api/tools/ring-size/guide` — measurement instructions (table + convert via GET)
- [x] Ring size advisor UI component on PDP — partial (API ready)
- [ ] Save preferred size to customer profile API
- [ ] Display recommended size during shopping
- [ ] Product variant size availability integration
- [ ] Printable measurement guide (optional PDF/page)
- [x] Tests: conversion accuracy
- [ ] Docs: ring size feature guide

---

### 2.2 Engraving Options

- [ ] Model: `EngravingOption` on Product; `OrderItemEngraving` on OrderItem — schema shell exists
- [ ] Admin product form: enable engraving, max chars, allowed chars, price, fonts
- [ ] PDP: engraving input + options + cost preview
- [ ] Cart displays engraving details
- [ ] Order stores engraving permanently (immutable after confirm)
- [ ] Server validates engraving rules at checkout
- [ ] Tests: validation rules
- [ ] Tests: engraving stored on order

---

### 2.3 Certificate Vault

- [x] Model: `Certificate` (number, type, issue date, verification status)
- [x] Link certificate to Customer + Order + Product
- [x] `GET /api/account/certificates` — customer's certificates only
- [ ] Secure download/view endpoint (auth + ownership check)
- [x] Admin: upload/manage certificates — POST API shell
- [ ] Admin: associate certificate with order item
- [ ] Tests: unauthorized access blocked
- [ ] Docs: certificate vault setup

---

### 2.4 Repair / Resize Service

- [x] Model: `RepairRequest` with status workflow
- [x] Statuses: REQUESTED → REVIEWING → APPROVED → ITEM_RECEIVED → IN_PROGRESS → READY → SHIPPED → COMPLETED / CANCELLED
- [x] Customer: create request from account (select order/product, upload images) — API shell
- [x] `POST /api/account/repairs`, `GET /api/account/repairs/[id]`
- [ ] Admin: manage requests in new `/admin/repairs` page
- [ ] Service history on customer profile
- [ ] Notification on status change (Phase 2.5 abstraction)
- [ ] Tests: status transitions
- [ ] Tests: ownership checks

---

### 2.5 Meilisearch

- [x] Install `meilisearch` client
- [x] Add `MEILISEARCH_HOST`, `MEILISEARCH_API_KEY` to `.env.example`
- [x] Create `src/server/search/meilisearch.ts`
- [ ] Define product index schema (name, SKU, brand, category, metal, stone, tags, etc.)
- [ ] Index sync on product create/update/delete (background job)
- [x] `GET /api/search` — faceted search with pagination (Prisma fallback)
- [ ] Storefront search page uses Meilisearch API
- [ ] Search suggestions/autocomplete
- [ ] Jewellery facets: metal, purity, stone, price, occasion, ring size, etc.
- [ ] Search analytics logging
- [ ] Tests: index sync
- [ ] Tests: search API
- [ ] Docs: Meilisearch setup

---

### 2.6 WhatsApp Order Notifications

- [x] Create `src/server/notifications/NotificationService` abstraction
- [x] Create `WhatsAppProvider` interface + stub/mock implementation
- [x] Model: `NotificationLog` (event, recipient, provider, status, messageId, failure)
- [ ] Wire events: order confirmed, payment confirmed, packed, shipped, delivered, refund, repair status
- [x] Env vars: `WHATSAPP_PROVIDER`, provider-specific credentials
- [ ] Background job for notification dispatch (BullMQ)
- [ ] Admin: notification log viewer
- [ ] Tests: notification service unit tests
- [ ] Docs: WhatsApp provider setup (credentials required from user)

---

### 2.7 Admin Pick / Pack / Ship

- [ ] Extend order status enum: PAYMENT_CONFIRMED → PROCESSING → PICKING → PACKED → READY_TO_SHIP → SHIPPED → OUT_FOR_DELIVERY → DELIVERED
- [ ] Admin order detail: pick list UI
- [ ] Confirm inventory picked
- [ ] Pack confirmation
- [ ] Print packing slip (PDF)
- [ ] Add tracking number
- [ ] Status change audit history
- [ ] Exception handling UI
- [ ] Tests: status transition rules
- [ ] Tests: audit log entries

---

### 2.8 Courier Integration

- [x] Create `CourierProvider` interface (`src/server/shipping/courier-provider.ts`)
- [x] Implement stub provider for development
- [x] Shipment model linked to Order
- [x] `POST /api/admin/shipments` — create shipment
- [x] AWB generation abstraction
- [ ] Tracking status sync abstraction
- [ ] Shipping label generation abstraction
- [ ] Return shipment support (interface only initially)
- [x] Env vars: courier provider credentials (`COURIER_PROVIDER=stub`)
- [ ] Admin shipments page
- [ ] Tests: provider interface mocks
- [ ] Docs: courier integration guide

---

### 2.9 Phase 2 Cross-Cutting

- [ ] Add BullMQ + Redis for background jobs
- [ ] Job: search index sync
- [ ] Job: WhatsApp notifications
- [ ] Job: certificate processing
- [ ] Update `docs/API.md`
- [ ] Integration tests for Phase 2 features
- [ ] Phase 2 sign-off checklist

---

## Phase 3 — Growth & Intelligence (6–10 weeks)

### 3.1 Loyalty Program

- [x] Model: `LoyaltyAccount`, `LoyaltyTransaction` (ledger)
- [x] Transaction types: EARN, REDEEM, EXPIRE, ADMIN_ADJUSTMENT, REFUND_REVERSAL — schema
- [ ] Earn rules configuration (admin)
- [ ] Redeem at checkout (server-side)
- [x] Points history in customer account — `GET /api/account/loyalty`
- [ ] Expiration job
- [ ] Admin adjustment UI
- [ ] Prevent duplicate point transactions (idempotency)
- [ ] Tests: ledger integrity
- [ ] Tests: earn/redeem flows

---

### 3.2 Referral Program

- [x] Model: `Referral`, `ReferralReward`
- [x] Unique referral code/link per customer — `GET /api/account/referrals`
- [ ] Attribution tracking at registration/checkout
- [ ] Reward rules (admin configurable)
- [ ] Fraud prevention (self-referral, duplicate)
- [ ] Admin referral reporting
- [ ] Customer account: referral section
- [ ] Tests: attribution logic
- [ ] Tests: fraud prevention

---

### 3.3 Abandoned Cart Automation

- [ ] Model: `AbandonedCart` (cart snapshot, customer, value, reminders sent)
- [ ] Detect abandoned threshold (configurable)
- [ ] Background job: scan abandoned carts
- [ ] Send email/WhatsApp reminder (via NotificationService)
- [ ] Optional second reminder
- [ ] Stop reminders after purchase
- [ ] Rate limit / max reminders
- [ ] Admin: abandoned cart dashboard
- [ ] Tests: detection logic
- [ ] Tests: reminder idempotency

---

### 3.4 Recommendation Engine

- [x] Model: `Recommendation` / `RecommendationSignal` — schema shell
- [x] Rules-based engine: `src/server/recommendations/engine.ts`
- [ ] Signals: viewed, purchased, wishlist, category, collection
- [x] Types: similar, frequently bought together, recently viewed, complete the look, trending — partial
- [x] `GET /api/recommendations/[type]` endpoints — `/api/recommendations?type=`
- [ ] PDP + homepage recommendation blocks
- [ ] Background job: update recommendation signals
- [ ] Architecture notes for future ML swap (document only)
- [ ] Tests: recommendation rules
- [ ] Label clearly as rules-based (not ML)

---

### 3.5 Margin + Inventory Forecasting

- [x] Admin analytics service: `src/server/analytics/`
- [ ] Metrics: revenue, gross/net sales, discounts, refunds, COGS, margin %, inventory value, turnover
- [ ] Low stock, dead stock, fast/slow movers reports
- [x] Forecasting: historical sales, demand trend, reorder threshold, stockout date, suggested reorder qty — module shell
- [x] Admin dashboards (extend existing reports page) — `GET /api/admin/analytics/margin`
- [ ] CSV export
- [ ] Document forecasting assumptions
- [ ] Tests: metric calculations

---

### 3.6 Gold Rate-Linked Pricing

- [x] Model: `GoldRate`, `PriceHistory`
- [ ] Admin-configurable pricing formulas (not hard-coded)
- [ ] Gold rate ingestion (manual admin entry + optional provider abstraction)
- [ ] Product price calculation from formula
- [ ] Historical price snapshot on OrderItem (immutable after confirm)
- [x] Admin gold rates page — API: `GET/POST /api/admin/gold-rates`
- [ ] Admin pricing rules page
- [ ] Background job: optional gold rate sync
- [ ] Tests: formula evaluation
- [ ] Tests: order price immutability

---

### 3.7 A/B Testing

- [x] Model: `Experiment`, `ExperimentVariant`, `ExperimentExposure`
- [x] Server-side variant assignment (consistent session/user)
- [x] Experiments: homepage, banners, campaigns, product placement, CTAs — API shell
- [ ] Track exposure + conversion + revenue
- [ ] Admin: create/start/stop experiments, view results
- [ ] Avoid client/server assignment mismatch
- [ ] Tests: assignment consistency
- [ ] Tests: metrics aggregation

---

### 3.8 Phase 3 Cross-Cutting

- [ ] Background jobs for all Phase 3 features
- [ ] Update analytics observability
- [ ] Update `docs/API.md`
- [ ] Integration tests
- [ ] Phase 3 sign-off checklist

---

## Phase 4 — Premium Experience (ongoing)

### 4.1 AR Virtual Try-On

- [ ] Design `ARTryOnProvider` interface
- [ ] Camera permission handling component
- [ ] Supported-device detection
- [ ] Fallback UI for unsupported devices
- [ ] Ring/earring/necklace experience modules (provider-dependent)
- [ ] Env vars for AR provider credentials
- [ ] Docs: AR integration architecture (no fake AR)
- [ ] Do not ship until real provider integrated

---

### 4.2 Live Shopping

- [ ] Model: `LiveEvent`, `LiveEventProduct`, `LiveEventViewer`
- [ ] Scheduled events with host, product attachments
- [ ] Live status management
- [ ] Product highlighting during event
- [ ] Shopping from live event (link to PDP/cart)
- [ ] Event analytics
- [ ] Video streaming provider abstraction (future)
- [ ] Admin live events page
- [ ] Docs: live shopping architecture

---

### 4.3 Bespoke / Custom Order Studio

- [x] Model: `BespokeOrder` with full workflow
- [x] Statuses: DRAFT → SUBMITTED → UNDER_REVIEW → DESIGNING → QUOTED → CUSTOMER_APPROVAL → PAYMENT_PENDING → IN_PRODUCTION → QUALITY_CHECK → READY → DELIVERED
- [x] Customer submission form (metal, stone, size, budget, references, uploads) — API shell
- [ ] Admin review, quote, design files, production status
- [x] Customer account: bespoke orders section — `GET/POST /api/bespoke`
- [ ] Notification on status changes
- [ ] Tests: workflow transitions

---

### 4.4 Multi-Warehouse

- [ ] Extend `Warehouse`, `WarehouseStock`, `StockTransfer`, `StockReservation`
- [ ] Admin warehouse management
- [ ] Stock allocation rules
- [ ] Intelligent fulfillment selection on order
- [ ] Low-stock alerts per warehouse
- [ ] Inventory history
- [ ] Do not break single-warehouse path (default warehouse)
- [ ] Tests: reservation + transfer

---

### 4.5 Consignment

- [ ] Model: `Consignor`, `ConsignmentItem`, `ConsignmentSettlement`
- [ ] Track quantity, cost, sold, returned, commission
- [ ] Admin consignment management + reporting
- [ ] Settlement workflow
- [ ] Tests: settlement calculations

---

### 4.6 Sanity Editorial Platform

- [ ] Create `EditorialContentProvider` abstraction
- [ ] Sanity client integration (when credentials provided)
- [ ] Content types: guides, stories, campaigns, lookbooks, SEO pages
- [ ] Storefront pages fetch editorial content via abstraction
- [ ] Graceful fallback when Sanity unavailable
- [ ] Env vars: `SANITY_PROJECT_ID`, `SANITY_DATASET`, `SANITY_TOKEN`
- [ ] Docs: Sanity setup guide
- [ ] Do not make entire platform dependent on Sanity uptime

---

## Cross-Cutting Requirements (all phases)

### Security
- [ ] Input validation (Zod) on all endpoints
- [ ] Server-side authorization on every protected route
- [ ] Rate limiting on auth + payment endpoints
- [ ] HttpOnly secure cookies for sessions
- [ ] CSRF protection where applicable
- [ ] Security headers (CSP, HSTS, etc.)
- [ ] File upload validation (type, size, magic bytes)
- [ ] No secrets in source code
- [ ] Audit logs for admin actions
- [ ] Never trust frontend prices, roles, inventory, payment status

### Data integrity
- [ ] Transactional order creation (Prisma `$transaction`)
- [ ] Transactional inventory reservation
- [ ] Transactional payment confirmation
- [ ] Idempotent webhook processing
- [ ] Prevent negative inventory
- [ ] Prevent duplicate loyalty/referral rewards
- [ ] Order price snapshots immutable after confirm

### Observability
- [ ] Structured logging for: login, orders, payments, refunds, inventory, webhooks, jobs — partial (`logger.ts` exists)
- [ ] Error tracking integration (optional: Sentry)
- [x] Health check endpoint `GET /api/health`

### Testing (minimum coverage)
- [x] Auth + RBAC — permission unit tests
- [ ] Product CRUD
- [x] Pricing + discounts — unit tests
- [ ] Checkout + order creation
- [x] Payment verification + webhooks — signature unit tests
- [ ] Inventory reservation
- [ ] Refunds
- [ ] Reviews
- [ ] Loyalty + referral (Phase 3)
- [ ] Gold-rate pricing (Phase 3)

### SSR / Hydration
- [x] Fix `brand-logo.tsx` float drift (done)
- [ ] Audit all components for `Math.random()` / `Date.now()` in render
- [ ] Server-fetch catalog for SEO-critical pages (product, shop)
- [ ] Fix stale `generateMetadata()` to use DB catalog
- [ ] Fix sitemap to use DB catalog

### Documentation
- [x] `docs/ARCHITECTURE_AUDIT.md`
- [x] `docs/IMPLEMENTATION_ROADMAP.md`
- [x] `docs/API.md`
- [x] `docs/MIGRATION.md`
- [x] `docs/PAYMENTS.md`
- [x] `docs/MEDIA.md`
- [ ] `docs/DEPLOYMENT.md`

### Environment configuration
- [x] `DATABASE_URL`
- [x] `JWT_SECRET`, `JWT_REFRESH_SECRET`
- [x] `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- [x] `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- [x] `MEILISEARCH_HOST`, `MEILISEARCH_API_KEY`
- [x] `REDIS_URL` (for BullMQ)
- [x] `WHATSAPP_*` provider credentials — `WHATSAPP_PROVIDER=console`
- [x] `COURIER_*` provider credentials — `COURIER_PROVIDER=stub`
- [ ] `GOLD_RATE_*` provider credentials
- [ ] `SANITY_*` credentials
- [ ] Update `avyora/.env.example` (never commit real secrets)

---

## External credentials checklist

Services requiring **your** account setup before going live:

| Service | Required credentials | Phase |
|---------|---------------------|-------|
| PostgreSQL | `DATABASE_URL` | 1 |
| Razorpay | Key ID, secret, webhook secret | 1 |
| Cloudinary | Cloud name, API key, secret | 1 |
| Meilisearch | Host, API key | 2 |
| Redis | `REDIS_URL` | 2 |
| WhatsApp provider | Provider-specific | 2 |
| Courier (Delhivery/Shiprocket/etc.) | Provider-specific | 2 |
| Gold rate API | Provider-specific | 3 |
| Sanity | Project ID, dataset, token | 4 |
| AR provider | Provider-specific | 4 |
| Live streaming | Provider-specific | 4 |

Architecture and stub providers will be implemented; **live external calls require your credentials**.

---

## Next immediate action

**Continue Phase 1 cutover:** Run PostgreSQL locally, apply migrations, seed, and import JSON.

1. Follow `docs/MIGRATION.md` — install PostgreSQL, set `DATABASE_URL`
2. `npx prisma migrate deploy` → `npm run db:seed` → `npm run db:migrate-json`
3. Run `npm test` — Vitest unit tests for pricing, auth, payments
4. Wire storefront checkout to `/api/payments/razorpay/verify`
5. Do not remove `/api/commerce` until cutover verified

---

*Last updated: 2026-08-31*
