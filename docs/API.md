# Avyora API Reference

**Last updated:** 2026-08-31

All JSON API routes return envelopes in one of two shapes:

**Success:** `{ "ok": true, "data": … }`  
**Error:** `{ "ok": false, "error": "message", "details"?: … }`

## Database availability

Most PostgreSQL-backed routes return **503** when `DATABASE_URL` is missing or the database is unreachable:

```json
{
  "ok": false,
  "error": "Database is temporarily unavailable. Please try again later."
}
```

`GET /api/health` also returns **503** when the database check fails.

## Legacy commerce mode

`GET /api/commerce` and `PUT /api/commerce` remain available for the legacy JSON snapshot (`commerce.json`). New features use PostgreSQL via Prisma. Do not remove `/api/commerce` until cutover is verified.

---

## Health

### `GET /api/health`

| | |
|---|---|
| **Auth** | None |
| **Body** | — |
| **Response 200** | `{ "ok": true, "db": true, "timestamp": "ISO-8601" }` |
| **Response 503** | `{ "ok": false, "db": false, "timestamp": "ISO-8601" }` |

---

## Authentication

Customer and staff sessions use HttpOnly cookies (`avyora_access`, `avyora_refresh`) set by login routes.

### `POST /api/auth/register`

| | |
|---|---|
| **Auth** | None |
| **Body** | `{ "name": string, "email": string, "password": string }` — password min 8 chars, must include letter + number |
| **Response 201** | `{ "ok": true, "data": { "user": { "id", "email", "name", "role" }, "customer": { "id", "groupId" } } }` |
| **Errors** | 400 duplicate email / validation; 503 DB unavailable |

### `POST /api/auth/login`

| | |
|---|---|
| **Auth** | None |
| **Body** | `{ "email": string, "password": string }` |
| **Response 200** | Sets auth cookies; `{ "ok": true, "data": { "user", "customer" } }` |
| **Errors** | 401 invalid credentials; 403 disabled/blocked; 429 account locked; 503 DB unavailable |

### `POST /api/auth/staff/login`

| | |
|---|---|
| **Auth** | None |
| **Body** | `{ "email": string, "password": string }` |
| **Response 200** | Sets auth cookies; `{ "ok": true, "data": { "user", "admin", "permissions": string[] } }` |
| **Errors** | 401 / 403 / 429 / 503 |

### `POST /api/auth/logout`

| | |
|---|---|
| **Auth** | Optional (clears cookies even if unauthenticated) |
| **Body** | — |
| **Response 200** | `{ "ok": true, "data": { "loggedOut": true } }` |

### `POST /api/auth/refresh`

| | |
|---|---|
| **Auth** | Refresh cookie (`avyora_refresh`) |
| **Body** | — |
| **Response 200** | New access + refresh cookies; `{ "ok": true, "data": { "user": { "id", "email", "role" } } }` |
| **Errors** | 401 missing/invalid refresh token; 503 DB unavailable |

### `POST /api/auth/forgot-password` *(legacy JSON)*

| | |
|---|---|
| **Auth** | None |
| **Body** | `{ "email": string }` |
| **Response 200** | Sends 6-digit code via SMTP when configured |
| **Note** | Uses `commerce.json` customer store until full DB cutover |

### `POST /api/auth/reset-password` *(legacy JSON)*

| | |
|---|---|
| **Auth** | None |
| **Body** | `{ "email": string, "token": string (6 digits), "password": string }` |
| **Response 200** | `{ "ok": true }` |

---

## Checkout

### `POST /api/checkout/preview`

| | |
|---|---|
| **Auth** | Optional — customer session applies group discounts |
| **Body** | `{ "items": [{ "productId", "sku", "quantity" }], "couponCode"?: string, "shippingMethodId"?: string }` |
| **Response 200** | `{ "ok": true, "data": { "lines", "totals": { "subtotal", "couponDiscount", "groupDiscount", "shipping", "tax", "total", "applied" }, "couponApplied": boolean } }` |
| **Errors** | 400 invalid items; 503 DB unavailable |

### `POST /api/checkout/place`

| | |
|---|---|
| **Auth** | Required for logged-in checkout; guest allowed with `contactEmail` |
| **Body** | `{ "items", "address": { "name", "phone", "line1", "line2"?, "city", "state", "pincode" }, "paymentMethod": "razorpay" \| "cod", "couponCode"?, "shippingMethodId"?, "contactEmail"?, "giftWrap"?, "giftMessage"? }` |
| **Response 201** | `{ "ok": true, "data": { "orderId", "orderNumber", "total", "paymentMethod", "status", "razorpay"?: { "orderId", "amount", "keyId", "demo" } } }` |
| **Errors** | 400 validation; 401 auth; 503 DB unavailable |

---

## Payments (Razorpay)

### `POST /api/payments/razorpay/order`

| | |
|---|---|
| **Auth** | None (amount validated server-side) |
| **Body** | `{ "amount"?: number, "orderId"?: string, "receipt"?: string, "currency"?: string, "notes"?: Record<string,string> }` |
| **Response 200** | `{ "ok": true, "data": { "orderId", "amount" (paise), "currency", "keyId", "demo", "receipt" } }` |
| **Errors** | 400 invalid amount; 404 order not found; 502 Razorpay error; 503 DB unavailable |

### `POST /api/payments/razorpay/verify`

| | |
|---|---|
| **Auth** | None |
| **Body** | `{ "orderId": string, "razorpay_order_id", "razorpay_payment_id", "razorpay_signature" }` |
| **Response 200** | `{ "ok": true, "data": { "orderId", "orderNumber", "status", "paymentStatus", "alreadyVerified" } }` |
| **Errors** | 400 invalid signature; 404 order/payment not found; 503 DB unavailable |

### `POST /api/payments/razorpay/webhook`

| | |
|---|---|
| **Auth** | HMAC — header `x-razorpay-signature` |
| **Body** | Raw Razorpay webhook JSON |
| **Response 200** | `{ "ok": true, "data": { "received": true, "event"?, "duplicate"?, "matched"?: false } }` |
| **Errors** | 401 invalid signature; 400 invalid payload; 503 DB unavailable |

---

## Products & reviews

### `GET /api/products/[slug]/reviews`

| | |
|---|---|
| **Auth** | None |
| **Query** | `page` (default 1), `limit` (default 10, max 50) |
| **Response 200** | `{ "ok": true, "data": { "reviews": [{ "id", "rating", "title", "body", "verified", "helpfulCount", "createdAt", "author" }], "pagination": { "page", "limit", "total", "totalPages" } } }` |
| **Errors** | 404 product not found; 503 DB unavailable |

### `POST /api/products/[slug]/reviews`

| | |
|---|---|
| **Auth** | Customer session required |
| **Body** | `{ "rating": 1–5, "title": string, "body": string }` |
| **Response 201** | `{ "ok": true, "data": { "id", "status": "PENDING", "message" } }` |
| **Errors** | 401 / 403 verified purchase required; 409 duplicate review; 503 DB unavailable |

---

## Media

### `POST /api/media/upload`

| | |
|---|---|
| **Auth** | Staff with `MEDIA_MANAGE` or admin |
| **Body** | `multipart/form-data`: `file` (image, max 8MB), `folder`? (default `avyora`) |
| **Response 200** | `{ "ok": true, "data": { "url", "publicId", "local": boolean } }` |
| **Errors** | 401 / 403; 400 validation; 503 DB unavailable |

### `POST /api/upload` *(legacy local disk)*

| | |
|---|---|
| **Auth** | None |
| **Body** | `multipart/form-data`: `file` (image) |
| **Response 200** | `{ "url": "/products/…" }` |
| **Note** | Writes to `public/products/`. Prefer `/api/media/upload` in production. |

---

## Search

### `GET /api/search`

| | |
|---|---|
| **Auth** | None |
| **Query** | `q`, `limit`, `offset`, `facets` (comma-separated) |
| **Response 200** | `{ "ok": true, "data": { "hits", "total", "facets"?, "source": "meilisearch" \| "prisma" } }` |
| **Errors** | 503 DB unavailable |

---

## Tools

### `GET /api/tools/ring-size`

| | |
|---|---|
| **Auth** | None |
| **Query** | `from` (INDIA/US/UK/EU), `to`, `value` — omit `value` for full table |
| **Response 200** | Conversion result or `{ "table", "systems" }` |
| **Errors** | 400 invalid system; 404 size not found |

### `POST /api/tools/ring-size`

| | |
|---|---|
| **Auth** | None |
| **Body** | `{ "circumferenceMm": number }` |
| **Response 200** | `{ "ok": true, "data": { "circumferenceMm", "recommendedIndiaSize", "row", "conversions": { "us", "uk", "eu" } } }` |

---

## Customer account

All routes require customer authentication unless noted.

### `GET /api/account/certificates`

| | |
|---|---|
| **Auth** | Customer |
| **Response 200** | Array of certificate records with product summary |

### `POST /api/account/certificates`

| | |
|---|---|
| **Auth** | Staff (`ORDER_UPDATE` or `SETTINGS_MANAGE`) |
| **Body** | `{ "customerId", "number", "type", "productId"?, "orderId"?, "issueDate"?, "documentUrl"? }` |
| **Response 201** | Created certificate |

### `GET /api/account/repairs`

| | |
|---|---|
| **Auth** | Customer |
| **Response 200** | Array of repair requests |

### `POST /api/account/repairs`

| | |
|---|---|
| **Auth** | Customer |
| **Body** | `{ "type": RepairType enum, "description": string (min 10), "orderId"?, "productName"?, "imageUrls"?: string[] }` |
| **Response 201** | Created repair request |

### `GET /api/account/repairs/[id]`

| | |
|---|---|
| **Auth** | Customer (ownership) |
| **Response 200** | Repair request detail |

### `PATCH /api/account/repairs/[id]`

| | |
|---|---|
| **Auth** | Customer (limited updates) |
| **Body** | Partial repair fields |

### `GET /api/account/loyalty`

| | |
|---|---|
| **Auth** | Customer |
| **Response 200** | `{ "balance", "tier", "transactions" }` |

### `GET /api/account/referrals`

| | |
|---|---|
| **Auth** | Customer |
| **Response 200** | `{ "code", "referrals" }` |

### `POST /api/account/referrals`

| | |
|---|---|
| **Auth** | Customer |
| **Body** | Referral attribution payload |
| **Response 201** | Referral record |

---

## Bespoke orders

### `GET /api/bespoke`

| | |
|---|---|
| **Auth** | Customer |
| **Response 200** | Array of bespoke orders with recent history |

### `POST /api/bespoke`

| | |
|---|---|
| **Auth** | Customer |
| **Body** | `{ "jewelleryType", "metal"?, "purity"?, "stone"?, "size"?, "budgetMin"?, "budgetMax"?, "engraving"?, "notes"?, "referenceUrls"?, "guestEmail"? }` |
| **Response 201** | Created bespoke order |

---

## Recommendations

### `GET /api/recommendations`

| | |
|---|---|
| **Auth** | None |
| **Query** | `type` (`trending`, `similar`, …), `productId`?, `limit` (max 24) |
| **Response 200** | `{ "ok": true, "data": { "type", "products": [...] } }` |

---

## Experiments (A/B)

### `POST /api/experiments/assign`

| | |
|---|---|
| **Auth** | None |
| **Body** | `{ "experimentKey", "sessionId", "userId"? }` |
| **Response 200** | `{ "ok": true, "data": { "variantKey", "config", "experimentKey" } }` |
| **Errors** | 404 experiment not running |

---

## Admin

### `GET /api/admin/gold-rates`

| | |
|---|---|
| **Auth** | Staff — `SETTINGS_MANAGE` |
| **Query** | `purity`? |
| **Response 200** | Array of gold rate records |

### `POST /api/admin/gold-rates`

| | |
|---|---|
| **Auth** | Staff — `SETTINGS_MANAGE` |
| **Body** | `{ "purity", "ratePerGram", "unit"?, "source"?, "effectiveAt"? }` |
| **Response 201** | Created rate |

### `POST /api/admin/shipments`

| | |
|---|---|
| **Auth** | Staff — `ORDER_UPDATE` |
| **Body** | `{ "orderId", "weightGrams"? }` |
| **Response 201** | `{ "ok": true, "data": { "shipment", "awb", "labelUrl"?, "provider" } }` |

### `GET /api/admin/analytics/margin`

| | |
|---|---|
| **Auth** | Staff — `REPORT_VIEW` |
| **Query** | Date range filters |
| **Response 200** | Margin analytics summary |

---

## Legacy commerce snapshot

### `GET /api/commerce`

| | |
|---|---|
| **Auth** | None |
| **Response 200** | Full `CommerceSnapshot` JSON from `commerce.json` |

### `PUT /api/commerce`

| | |
|---|---|
| **Auth** | None *(admin UI only — migrate to authenticated APIs)* |
| **Body** | Partial `CommerceSnapshot` merge |
| **Response 200** | `{ "ok": true }` |

---

## SMTP & notifications *(legacy / ops)*

### `GET /api/smtp` · `PUT /api/smtp`

SMTP settings stored in commerce snapshot.

### `POST /api/smtp/test`

Send test email with configured SMTP.

### `POST /api/orders/notify`

| | |
|---|---|
| **Auth** | None *(internal — uses commerce templates)* |
| **Body** | `{ "event": "order" \| "ship", "orderId", "to", "tracking"?, "total"?, "name"? }` |
| **Response 200** | `{ "ok": true }` or `{ "ok": true, "skipped": true }` |
| **Errors** | 503 SMTP not configured |

---

## Response status summary

| Code | Meaning |
|------|---------|
| 200 / 201 | Success |
| 400 | Validation / bad request |
| 401 | Authentication required |
| 403 | Forbidden / insufficient permissions |
| 404 | Resource not found |
| 409 | Conflict (e.g. duplicate review) |
| 429 | Rate limit / account lock |
| 500 | Internal error |
| 502 | Upstream payment error |
| **503** | **Database or SMTP unavailable** |
