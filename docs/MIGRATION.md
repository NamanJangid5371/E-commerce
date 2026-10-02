# Avyora — PostgreSQL Migration Runbook

**Last updated:** 2026-08-31

This guide walks through moving Avyora from the legacy `commerce.json` snapshot to PostgreSQL with Prisma.

---

## Prerequisites

- Node.js 20+
- npm (project uses `avyora/` as the app root)
- Windows 10/11 (steps below are Windows-specific)

---

## 1. Install PostgreSQL on Windows

1. Download the installer from [postgresql.org/download/windows](https://www.postgresql.org/download/windows/) (PostgreSQL 16+ recommended).
2. Run the installer:
   - Set a **superuser password** for the `postgres` account — remember it.
   - Default port: **5432**
   - Install **Stack Builder** components only if you need them (optional).
3. Confirm the service is running:
   - Open **Services** (`services.msc`) → **postgresql-x64-16** (or your version) → Status should be **Running**.
4. Optional: add `psql` to PATH (installer usually offers this).

Create the application database:

```powershell
psql -U postgres -c "CREATE DATABASE avyora;"
```

Or via pgAdmin: connect as `postgres` → Databases → Create → name `avyora`.

---

## 2. Configure environment

Copy the example env file and set your connection string:

```powershell
cd avyora
copy .env.example .env
```

Edit `.env`:

```env
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/avyora?schema=public
JWT_SECRET=<long-random-string>
JWT_REFRESH_SECRET=<another-long-random-string>
```

Replace `YOUR_PASSWORD` with the password you chose during install.

---

## 3. Apply Prisma migrations

From the `avyora/` directory:

```powershell
npm install
npm run db:generate
npx prisma migrate deploy
```

- `db:generate` — generates the Prisma client
- `migrate deploy` — applies pending migrations (use in staging/production)
- For local iterative schema work: `npm run db:migrate` (`prisma migrate dev`)

If `DATABASE_URL` is wrong or PostgreSQL is stopped, commands fail with connection errors. Fix the service or URL before continuing.

---

## 4. Seed baseline data

```powershell
npm run db:seed
```

This creates:

- Default customer groups
- RBAC roles and permissions
- Admin user(s) with hashed passwords
- Catalog data derived from seed sources

Default admin credentials are printed in seed output — **change them after first login**.

---

## 5. Import legacy JSON data

Import existing `commerce.json` into PostgreSQL:

```powershell
npm run db:migrate-json
```

The script:

- Reads `commerce.json` (or configured path)
- Maps customers, products, orders, and related entities into Prisma models
- Preserves legacy IDs/slugs where possible
- Hashes customer passwords during import (or flags for reset)

### Never delete `commerce.json`

Keep the original file as a backup and rollback reference:

- Do **not** delete or overwrite `commerce.json` during migration
- Do **not** remove `/api/commerce` until cutover is verified
- Store a dated backup copy before running import

---

## 6. Verify migration

Manual checks:

```powershell
npx prisma studio
```

Confirm record counts for users, products, orders, and customer groups look reasonable.

Spot-check:

- Log in as a migrated customer via `POST /api/auth/login`
- Open admin with seeded staff account
- Run `GET /api/health` — expect `{ "ok": true, "db": true }`

---

## 7. npm scripts reference

| Script | Command | Purpose |
|--------|---------|---------|
| `db:generate` | `prisma generate` | Regenerate client after schema changes |
| `db:migrate` | `prisma migrate dev` | Create/apply migrations in development |
| `db:push` | `prisma db push` | Push schema without migration files (dev only) |
| `db:seed` | `tsx prisma/seed.ts` | Seed roles, admin, catalog |
| `db:migrate-json` | `tsx scripts/migrate-from-json.ts` | Import `commerce.json` |
| `db:studio` | `prisma studio` | Visual DB browser |

---

## Credentials checklist

Before going live, ensure these are set (never commit real values):

| Variable | Required for | Phase |
|----------|--------------|-------|
| `DATABASE_URL` | All DB-backed APIs | 1 |
| `JWT_SECRET` | Customer/staff sessions | 1 |
| `JWT_REFRESH_SECRET` | Token refresh | 1 |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Live payments | 1 |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook verification | 1 |
| `CLOUDINARY_*` | Cloud media uploads | 1 |
| `MEILISEARCH_*` | Faceted search | 2 |
| `REDIS_URL` | Background jobs | 2 |
| `WHATSAPP_PROVIDER` + credentials | Order notifications | 2 |
| `COURIER_PROVIDER` + credentials | Shipments | 2 |

See [PAYMENTS.md](./PAYMENTS.md) and [MEDIA.md](./MEDIA.md) for provider-specific setup.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `P1001: Can't reach database server` | Start PostgreSQL service; check host/port |
| `P1000: Authentication failed` | Verify username/password in `DATABASE_URL` |
| APIs return **503** | Database unreachable — check `GET /api/health` |
| Seed fails on duplicate | DB already seeded; use fresh DB or adjust seed |
| JSON import partial | Check script logs; re-run is idempotent where designed |

---

## Rollback strategy

1. Keep `commerce.json` intact — storefront can still use `/api/commerce` in legacy mode
2. Export PostgreSQL backup before major imports: `pg_dump -U postgres avyora > backup.sql`
3. To reset dev DB: drop and recreate `avyora`, then re-run migrate + seed + import
