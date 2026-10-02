# Avyora production platform — setup status

**Date:** 2026-08-31

## What was delivered in this build

The codebase now includes a production-oriented platform **alongside** the existing JSON/Zustand MVP (dual-mode). Existing storefront/admin UI still works without PostgreSQL.

### Phase 0
- Architecture audit + implementation roadmap in `/docs`

### Phase 1 (code complete; needs your Postgres + secrets to go live)
- Prisma schema (commerce + Phase 2–4 shells)
- SQL migration: `prisma/migrations/20260831120000_init`
- Seed + `scripts/migrate-from-json.ts`
- Server auth (bcrypt, JWT cookies, RBAC)
- Checkout preview/place APIs (server-side pricing)
- Razorpay create / verify / webhook
- Cloudinary upload with local fallback
- Customer reviews API
- Media upload API
- Health + search APIs
- Vitest: 17 tests passing

### Phase 2–4 (schema + APIs + admin pages + account sections)
- Ring size tool API
- Certificates, repairs, loyalty, referrals APIs
- Recommendations, gold rates, shipments, bespoke, experiments, margin analytics
- Admin pages for repairs, certificates, gold rates, bespoke, loyalty, consignments, live, experiments
- Notification service abstraction (console providers)
- Courier stub provider
- In-process job runner (BullMQ when Redis available)

## What YOU must do to activate production mode

1. Install PostgreSQL and set `DATABASE_URL` in `avyora/.env`
2. Run:
   ```bash
   cd avyora
   npx prisma migrate deploy
   npm run db:seed
   npm run db:migrate-json   # optional import of data/commerce.json
   ```
3. Set JWT secrets, Razorpay webhook secret, Cloudinary, Meilisearch, Redis as needed (see `.env.example`)
4. Point Razorpay webhook to `https://YOUR_DOMAIN/api/payments/razorpay/webhook`
5. After cutover, set `ALLOW_LEGACY_COMMERCE_WRITE=false`

## Honest limits

| Item | Status |
|------|--------|
| Full rewrite off JSON overnight | Not forced — dual-mode preserves working app |
| Live Postgres on this machine | Not installed (no Docker/psql found) |
| Real WhatsApp / courier / AR / Sanity live calls | Architecture + stubs; need your provider credentials |
| 100% of every admin CRUD on Prisma | Resource APIs for critical paths; legacy `/api/commerce` still powers many admin edits until cutover |

See `docs/MIGRATION.md`, `docs/API.md`, `docs/PAYMENTS.md`, `docs/MEDIA.md`.
