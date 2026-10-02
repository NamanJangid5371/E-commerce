# Avyora — Phase 0 Architecture Audit

**Audit date:** 2026-08-31  
**Project root:** `E-commerce/`  
**Application:** `E-commerce/avyora/`  
**Auditor scope:** Full codebase inspection before production migration

---

## Executive Summary

Avyora is a **Next.js 16.3.1 + React 19** jewellery e-commerce MVP implemented as a **single codebase** with **dual dev hosts**:

| Host | Port | Purpose |
|------|------|---------|
| Storefront | 3000 | Customer shopping, account, checkout |
| Admin | 3001 | Staff back-office (`AVYORA_APP=admin`) |

**Important correction vs. assumed architecture:** This repository does **not** use MongoDB, a separate Node.js backend service, or two independent React applications. Persistence is a **JSON file** (`avyora/data/commerce.json`) plus **browser localStorage/cookies**, with business logic split between Next.js API routes and a large Zustand store.

The app is strong on **UI breadth** (~20 storefront routes, ~29 admin routes) but is **not production-ready** without database migration, server auth, payment verification, and API hardening.

---

## 1. Current Folder Structure

```
E-commerce/
├── package.json              # Wrapper scripts → avyora/
├── README.md
├── docs/                     # Architecture docs (this file)
└── avyora/
    ├── package.json          # Next.js app dependencies
    ├── next.config.ts        # distDir: .next vs .next-admin
    ├── tsconfig.json
    ├── eslint.config.mjs
    ├── .env.example
    ├── .gitignore
    ├── README.md
    ├── AGENTS.md
    ├── data/                 # Runtime persistence (gitignored)
    │   ├── commerce.json     # Full commerce snapshot
    │   └── smtp.json         # SMTP credentials
    ├── public/               # Static assets (mostly SVG; product JPGs often missing)
    └── src/
        ├── middleware.ts     # Port-based routing (no auth)
        ├── app/              # App Router pages + API routes
        ├── components/       # UI, admin layout, providers
        ├── data/             # Seed catalog, admin-ops, content, types
        ├── lib/              # host, mail, pricing, media, appointments, etc.
        ├── server/           # commerce-db.ts, smtp-config.ts
        └── store/            # shop-store.ts (~1000 lines), shop-types.ts
```

**~104 TypeScript/TSX files** under `avyora/src/`.

---

## 2. Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Framework | Next.js (App Router) | 16.3.1 |
| UI | React | 19.2.8 |
| Styling | Tailwind CSS | 4 |
| State | Zustand + persist | 5.0.15 |
| Email | Nodemailer | 9.0.5 |
| PDF | jsPDF | 4.2.1 |
| Language | TypeScript | 5 |
| Lint | ESLint + eslint-config-next | 9 / 16.3.1 |

### Dev scripts

```bash
npm run dev          # Both storefront (3000) + admin (3001)
npm run dev:store    # Storefront only
npm run dev:admin    # Admin only
```

### NOT present (documented as future targets only)

- MongoDB / Mongoose
- PostgreSQL / Prisma
- NestJS backend
- Redis / BullMQ
- Cloudinary
- Meilisearch
- Sanity CMS
- Test framework (Jest, Vitest, Playwright)

---

## 3. Current Database / Persistence Model

There is **no relational or document database**. All persistence layers:

| Layer | Location | Contents | Risk |
|-------|----------|----------|------|
| **Primary store** | `avyora/data/commerce.json` | Catalog, orders, customers, ops, audit, appointments | Unauthenticated read/write via API |
| **SMTP config** | `avyora/data/smtp.json` | Email credentials | Unauthenticated API access |
| **Client state** | `localStorage` key `avyora-commerce-v2` | Cart, wishlist, customer session | Not shared across devices |
| **Admin cookie** | `avyora_admin` (7-day, not HttpOnly) | `{ name, email }` JSON | Forgeable |
| **Seed data** | `src/data/catalog.ts`, `admin-ops.ts` | 16 products, admin users, settings | Merged on load |
| **Uploads** | `public/products/` | Product images | No auth on upload API |

### CommerceSnapshot schema (effective JSON schema)

```typescript
{
  catalog: Product[]           // 16 seed products, admin-editable
  collections: Collection[]
  coupons: Coupon[]
  customers: Customer[]        // includes plaintext passwords
  orders: Order[]
  campaigns: Campaign[]
  mediaUrls: string[]
  audit: AuditEntry[]
  appointments: Appointment[]
  ops: AdminOps                // categories, brands, settings, adminUsers, groups, etc.
  updatedAt?: string
}
```

### Entity mapping to target Prisma models

| Current (JSON/Zustand) | Target Prisma entity | Notes |
|------------------------|----------------------|-------|
| `customers[]` | Customer, User, Address | Passwords plaintext; addresses embedded |
| `ops.adminUsers[]` | AdminUser, Role, Permission | Shared password `avyora123` |
| `ops.groups[]` | CustomerGroup | Discounts not applied at checkout |
| `catalog[]` | Product, ProductVariant, ProductImage | Variants embedded in product |
| `collections[]` | Collection | Many-to-many with products via tags/slugs |
| `ops.categories[]`, `brands[]` | Category, Brand | Separate from catalog facets |
| `orders[]` | Order, OrderItem, Payment | Payment status client-set |
| `coupons[]` | Coupon, Discount | Server validation minimal |
| `catalog[].reviews[]` | Review | Seed-only; no customer submission |
| cart (Zustand) | Cart, CartItem | Not persisted server-side |
| wishlist (Zustand) | Wishlist | Not persisted server-side |
| `ops.stockMoves[]` | Inventory, Warehouse | Single implicit warehouse |
| `ops.shippingMethods[]` | Shipping | Config only |
| `appointments[]` | Appointment | Atelier visits |
| `audit[]` | AuditLog | Client-generated entries |
| `ops.searches[]` | Search analytics | Aggregated client-side |
| — | Certificate, RepairRequest, Loyalty, Referral, etc. | **Not implemented** |

---

## 4. Current API Structure

All routes: `avyora/src/app/api/`

| Route | Methods | Auth | Purpose |
|-------|---------|------|---------|
| `/api/commerce` | GET, PUT | **None** | Read/write entire commerce snapshot |
| `/api/auth/register` | POST | None | Create customer (plaintext password) |
| `/api/auth/forgot-password` | POST | None | 6-digit reset code via SMTP |
| `/api/auth/reset-password` | POST | None | Reset password with code |
| `/api/payments/razorpay/order` | POST | None | Create Razorpay order or demo payload |
| `/api/orders/notify` | POST | None | Send order/shipment email |
| `/api/upload` | POST | None | Save image to `public/products/` |
| `/api/smtp` | GET, PUT | None | Read/save SMTP settings |
| `/api/smtp/test` | POST | None | Send test email |

**No REST conventions for resources.** Single monolithic snapshot endpoint is the primary data API.

**No API documentation file exists.**

---

## 5. Authentication Flow

### Customer (storefront, port 3000)

```
/login → shop-store.login()
  → Compare email/password against customers[] in Zustand (synced from /api/commerce)
  → Plaintext password comparison
  → Brute-force lockout: 5 failures → 15 min lock
  → Session stored in localStorage (Zustand persist)
```

- Register/forgot/reset use API routes, then `fetchCommerce()` syncs state
- **No server session/JWT for customer login**
- Legacy customers without password accept any 8+ char password once

### Staff (admin, port 3001)

```
/staff-login → shop-store.staffLogin()
  → Match email to ops.adminUsers[]
  → Hardcoded password "avyora123" for ALL staff
  → Set avyora_admin cookie + Zustand user { role: "admin" }
```

- Session restored in `providers.tsx` via cookie + adminUsers lookup
- Admin user **not** persisted to localStorage

### Middleware (`src/middleware.ts`)

- Port 3000: redirects `/admin`, `/staff-login` → admin origin
- Port 3001: redirects `/login` → `/staff-login`; non-`/admin` → `/admin`
- **Does not enforce authentication**

---

## 6. Authorization (RBAC)

### Data model (`admin-ops.ts`)

```typescript
AdminAccount {
  id, name, email, role, active,
  permissions: string[]  // e.g. ["products", "orders"] or ["*"]
}
```

Seed accounts:

| Email | Role | Permissions |
|-------|------|-------------|
| admin@avyora.com | Super Admin | `["*"]` |
| catalog@avyora.com | Catalog Manager | `["products", "inventory", "categories", "orders"]` |
| orders@avyora.com | Order Manager | `["orders", "returns", "shipping", "customers"]` |

### Enforcement

- **Client-side only:** `admin-layout.tsx` `allowed(perm)` filters sidebar nav
- **No server-side RBAC** on any API route
- **No route-level guards** beyond client redirect to `/staff-login`

### RBAC bugs

| Issue | Detail |
|-------|--------|
| Nav perm `"*"` on many items | Treated as "visible to all staff" in `allowed()` — not super-admin-only |
| Orders nav uses `perm: "*"` | Order Manager cannot see Orders despite having `"orders"` permission |
| `"reports"` permission | No seed user has it; only `*` bypass works |
| Direct URL access | Restricted pages reachable if session exists |
| API bypass | `PUT /api/commerce` overwrites all data without auth |

---

## 7. Payment Implementation (Razorpay)

### Current flow (`checkout/page.tsx`)

1. COD → `placeOrder()` immediately
2. Razorpay → POST `/api/payments/razorpay/order`
3. If demo mode or no keys → simulated 600ms delay → order placed
4. Else Razorpay checkout modal → `handler` → `finalizeOrder()` **without signature verification**

### Server (`api/payments/razorpay/order/route.ts`)

- Creates real Razorpay order when env keys set
- Without keys: returns `order_demo_{timestamp}`

### Missing for production

- Webhook endpoint
- Payment signature verification (HMAC)
- Idempotent webhook processing
- Payment status sync (pending/failed/success)
- Refund API integration
- Server-side order total validation before payment
- `paymentId` is client-generated random string, not Razorpay ID

---

## 8. Media Handling

| Mechanism | Location | Status |
|-----------|----------|--------|
| Static library | `lib/media.ts` — 26 hardcoded `/products/*.jpg` paths | Referenced paths often missing from repo |
| File upload | `/api/upload` → `public/products/` | No auth, no size limit |
| Admin media page | URL add only via `addMediaUrl()` | No upload UI |
| Product form | Calls `/api/upload` + library picker | Works locally |
| Remote images | `next.config.ts` allows `images.unsplash.com` | OK |

**No Cloudinary integration.**

---

## 9. Search Implementation

- **Storefront:** Client-side substring filter on Zustand catalog (`/search`)
- **Logging:** `logSearch()` → `ops.searches[]` aggregated counts
- **Admin:** Search insights page displays logs; toggle product search visibility

**No Meilisearch, no server index, no typo tolerance beyond string includes.**

---

## 10. Order & Inventory Flow

### Order placement (`shop-store.placeOrder`)

1. Validate cart stock per variant (in-memory)
2. Compute totals via `cartTotals()` — coupons only, **no group discounts**
3. Decrement variant stock in catalog
4. Create order: status `"Confirmed"`, random trackingId
5. Increment coupon usageCount
6. Clear cart; append audit entry
7. Fire-and-forget email via `/api/orders/notify`

### Admin order lifecycle

- Status updates, tracking, notes, returns, refunds (client-side state changes)
- Shipped status triggers ship notification email

### Inventory

- Direct stock edits via admin inventory page
- `ops.stockMoves[]` audit trail

### Gaps

- No inventory reservation / optimistic locking
- No concurrent checkout protection
- Guest orders accessible by ID without ownership check
- Historic demo orders injected on load (`seedHistoricOrders()`)
- Customer group discounts defined but **never applied** in `cartTotals()`

---

## 11. Admin Portal Capabilities

**Entry:** `http://localhost:3001/staff-login` → `/admin`

| Section | Routes | Status |
|---------|--------|--------|
| Overview | Dashboard, Reports | Working (demo data inflated) |
| Catalog | Products, Categories, Brands, Attributes, Inventory | Working |
| Catalog (hidden) | `/admin/collections` | **Exists but missing from sidebar** |
| Sales | Orders, Payments, Returns, Shipping | Working |
| Customers | Customers, Atelier visits, Groups | Working |
| Marketing | Coupons, Promotions, Reviews, Search insights | Working |
| Website | Homepage, Banners, Pages, Menus, Media | Working |
| System | Notifications, Settings, Admin users, Audit | Working |

All admin pages are `"use client"` wrapped in `AdminLayout`.

---

## 12. Customer Portal Capabilities

| Route | Feature | Status |
|-------|---------|--------|
| `/` | Homepage with configurable sections | Working |
| `/shop` | Faceted catalogue | Working (CSR until hydration) |
| `/product/[slug]` | PDP with variants, spin viewer, reviews | Working |
| `/search` | Product search | Working (client-side) |
| `/cart`, `/checkout` | Bag + 3-step checkout | Working |
| `/orders/[id]` | Confirmation, tracking, invoice PDF, returns | Working |
| `/account` | 9 sections (profile, orders, addresses, etc.) | Working |
| `/login` | Sign in, register, forgot/reset password | Working |
| `/wishlist` | Saved products | Working |
| `/visit` | Atelier appointment booking | Working |
| `/about`, `/care`, `/faq`, `/policies/[slug]` | Content pages | Working |

---

## 13. Existing Integrations

| Integration | Status | Config |
|-------------|--------|--------|
| Razorpay | Partial (order create only) | `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` |
| SMTP/Nodemailer | Working | Env vars or `data/smtp.json` or admin settings |
| India PIN lookup | Working | `lib/pincode.ts` at checkout |
| jsPDF | Working | Invoice download |
| WhatsApp links | Product page links only | No notification service |
| Unsplash | Remote images allowed | `next.config.ts` |

---

## 14. Environment Variables

**File:** `avyora/.env.example`

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_STOREFRONT_ORIGIN` | Default `http://localhost:3000` |
| `NEXT_PUBLIC_ADMIN_ORIGIN` | Default `http://localhost:3001` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Email |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Razorpay public key |
| `RAZORPAY_KEY_SECRET` | Razorpay secret |

**Runtime-only (not documented in .env.example):**

- `AVYORA_APP=admin` — admin build distDir
- `NEXT_PUBLIC_AVYORA_APP=admin` — client admin host detection

---

## 15. Hydration / SSR Issues

| Issue | Status | Detail |
|-------|--------|--------|
| `brand-logo.tsx` SVG float drift | **Fixed** | Bead coords precomputed with `toFixed(3)` |
| Near-universal CSR | Open | 47/49 pages are `"use client"` |
| Catalog empty until hydrate | Open | Zustand + `/api/commerce` fetch required |
| SEO metadata stale | Open | `generateMetadata()` reads static seed, not live catalog |
| Sitemap stale | Open | Static seed products only |
| Dual-tab / poll race | Open | 4s polling + PUT on every change; last write wins |

---

## 16. Technical Debt

1. **Monolithic JSON snapshot** — entire DB read/written per change
2. **~1000-line Zustand store** — business logic, auth, cart, orders, catalog mutations
3. **Duplicate type definitions** — `data/types.ts` vs `store/shop-types.ts` (divergent shapes)
4. **Duplicate seed logic** — `shop-store.seedCatalog()` vs `commerce-db.seedCommerce()`
5. **No tests** — zero unit/integration/e2e coverage
6. **No job queue** — emails, indexing, notifications run inline or fire-and-forget
7. **Client-side commerce sync** — 4-second polling in `providers.tsx`
8. **Synthetic demo data** — historic orders, site visits inflate dashboards
9. **Incomplete RBAC** — nav filtering only; permission naming inconsistent
10. **README inaccuracies** — mentions MongoDB/NestJS as if present; password reset described as "one-hour link" but code uses 6-digit code / 15 min

---

## 17. Security Risks

| Severity | Risk | Location |
|----------|------|----------|
| **Critical** | Unauthenticated full DB read/write | `GET/PUT /api/commerce` |
| **Critical** | Plaintext customer passwords in JSON + API responses | `register/route.ts`, `commerce.json` |
| **Critical** | Shared hardcoded staff password | `staffLogin()` → `"avyora123"` |
| **Critical** | Unauthenticated file upload | `/api/upload` |
| **Critical** | Unauthenticated SMTP config read/write | `/api/smtp` |
| **High** | Forgeable admin cookie | `avyora_admin` client-set JSON |
| **High** | No Razorpay payment verification | Checkout handler |
| **High** | Open order notify endpoint | `/api/orders/notify` |
| **Medium** | No CSRF protection | All POST/PUT routes |
| **Medium** | Order pages lack ownership check | `/orders/[id]` |
| **Low** | Password reset tokens in commerce.json | `resetToken` plaintext |

---

## 18. Migration Risks

### JSON → PostgreSQL (not MongoDB → PostgreSQL)

There is **no MongoDB data to migrate**. Migration path:

1. Export `commerce.json` snapshot
2. Map entities to normalized Prisma schema
3. Transform embedded structures (variants, addresses, ops config)
4. Hash all passwords during import
5. Run dual-write or cutover with verification scripts
6. **Never delete** original JSON during migration

### Risks during migration

| Risk | Mitigation |
|------|------------|
| Downtime during cutover | Dual-write period; feature flags |
| ID format changes | Preserve slug-based IDs where possible; map legacy IDs |
| Client still uses Zustand + `/api/commerce` | Phase API replacement incrementally |
| Concurrent edits during migration | Freeze writes or version snapshot |
| Password re-hash breaks legacy logins | Force reset or migrate with known plaintext (dev only) |
| Historic demo orders pollute production | Filter synthetic order IDs on import |
| Dual-port Next.js pattern | Preserve middleware routing; add API auth layer |

### Architecture decision: keep dual-port or unify?

**Recommendation:** Keep dual-port dev hosts and shared codebase. Add NestJS or Next.js Route Handlers with Prisma as the **authoritative API layer**, gradually replacing `/api/commerce` monolith.

---

## 19. Duplicated Code

| Pattern | Locations |
|---------|-----------|
| Type definitions | `data/types.ts` ↔ `store/shop-types.ts` |
| Seed commerce | `shop-store.ts` ↔ `commerce-db.ts` |
| Password validation | `shop-store.ts`, `register/route.ts`, `reset-password/route.ts` |
| SMTP blank detection | `api/smtp/route.ts`, `server/smtp-config.ts` |
| Commerce sync | `providers.tsx` poll + subscribe + login page sync |
| Policy strings | `catalog.ts`, `product-form.tsx`, `admin-ops.ts` |

---

## 20. Broken / Incomplete Features

| Feature | Status |
|---------|--------|
| Product images in repo | Missing — paths referenced but files not committed |
| Razorpay live payments | No webhook, no signature verify |
| Customer group discounts | Admin UI exists; not applied at checkout |
| Email verification | Client flag only; no email sent |
| RBAC for Order Manager | Cannot see Orders in nav |
| Collections admin | Page exists; not in sidebar |
| Customer review submission | Seed reviews only |
| Meilisearch | Not implemented |
| Cloudinary | Not implemented |
| Maintenance mode | Partial — blocks checkout only |
| MongoDB | Never existed in this repo |

---

## 21. Dependencies to Add (Phase 1+)

| Package | Purpose |
|---------|---------|
| `@prisma/client`, `prisma` | PostgreSQL ORM |
| `bcrypt` or `@node-rs/argon2` | Password hashing |
| `jose` or `jsonwebtoken` | JWT/session tokens |
| `zod` | Input validation |
| `razorpay` (already used inline) | Formal SDK + webhook utils |
| `cloudinary` | Media pipeline |
| `meilisearch` | Search index |
| `bullmq`, `ioredis` | Background jobs |
| `vitest` or `jest` | Testing |
| `@testcontainers/postgresql` | Integration tests |

## 22. Dependencies to Remove / Replace

| Current | Replace with |
|---------|--------------|
| Monolithic `/api/commerce` PUT | Resource-scoped authenticated APIs |
| Plaintext password storage | bcrypt hashes |
| Client-side `placeOrder()` as source of truth | Server-side checkout API |
| 4-second polling sync | WebSocket or SWR with auth |
| `localStorage` cart as only persistence | Server-side cart for logged-in users |

---

## 23. Recommended Implementation Order

### Phase 0 ✅ (this document)
- Codebase audit complete

### Phase 1 — Make it real (4–6 weeks)
1. PostgreSQL + Prisma schema + migration from JSON
2. Server auth (JWT/cookies) + bcrypt + RBAC middleware
3. Replace `/api/commerce` with authenticated resource APIs
4. Razorpay webhook + signature verification
5. Cloudinary media pipeline
6. Customer group discounts (server-side checkout pricing)
7. Customer review submission + moderation
8. Vitest setup + critical path tests
9. Update `.env.example` + `/docs/API.md`

### Phase 2 — Jewellery differentiation (4–8 weeks)
7. Ring size advisor
8. Engraving options
9. Certificate vault
10. Repair/resize service requests
11. Meilisearch integration
12. WhatsApp notification abstraction
13. Pick/pack/ship workflow
14. Courier provider abstraction

### Phase 3 — Growth & intelligence (6–10 weeks)
15. Loyalty program (ledger)
16. Referral program
17. Abandoned cart automation (job queue)
18. Recommendation engine (rules-based)
19. Margin + inventory forecasting dashboards
20. Gold rate-linked pricing
21. A/B testing framework

### Phase 4 — Premium experience (ongoing)
22. AR virtual try-on (provider abstraction)
23. Live shopping infrastructure
24. Bespoke/custom order studio
25. Multi-warehouse inventory
26. Consignment module
27. Sanity editorial platform (abstraction layer)

---

## 24. Preserve vs. Replace Decision Matrix

| Component | Decision | Reason |
|-----------|----------|--------|
| Dual-port Next.js hosts | **Preserve** | Working; matches admin/customer separation goal |
| Existing admin UI pages | **Extend** | ~29 pages; reuse design system |
| Existing storefront UI | **Extend** | Strong jewellery UX already built |
| Zustand for cart/wishlist UI state | **Preserve initially** | Migrate cart persistence to server gradually |
| `/api/commerce` monolith | **Replace incrementally** | Security + scalability blocker |
| `commerce.json` | **Replace** | Not production-safe |
| Client-side auth | **Replace** | Server sessions/JWT required |
| Seed catalog data | **Migrate to DB seed** | Keep as Prisma seed script |
| `brand-logo.tsx` hydration fix | **Keep** | Already fixed |

---

## 25. Definition of Done (for future phases)

A feature is complete only when:

```
Frontend UI + Backend API + Database persistence + Validation
+ Authorization + Error handling + Tests + Documentation
```

---

## Appendix A — Key File Reference

| File | Role |
|------|------|
| `avyora/src/store/shop-store.ts` | Central state (~1010 lines): cart, auth, orders, catalog |
| `avyora/src/server/commerce-db.ts` | JSON file persistence |
| `avyora/src/middleware.ts` | Port routing (no auth) |
| `avyora/src/components/providers.tsx` | Boot, sync, 4s poll |
| `avyora/src/components/admin/admin-layout.tsx` | Admin shell + RBAC nav |
| `avyora/src/data/admin-ops.ts` | Admin config types + seeds |
| `avyora/src/data/catalog.ts` | 16 seed products |
| `avyora/src/components/brand-logo.tsx` | Logo (hydration fixed) |
| `avyora/.env.example` | Environment template |

---

*End of Phase 0 Architecture Audit*
