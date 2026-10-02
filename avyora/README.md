# Avyora

Premium jewellery commerce with **three portals** sharing one Next.js codebase and Postgres:

| Portal | URL | Purpose |
| --- | --- | --- |
| **Storefront** | http://localhost:3000 | Browse, bag, checkout, account, track |
| **Admin** | http://localhost:3001/admin | Catalogue, orders, customers, settings |
| **Logistics** | http://localhost:3002/logistics | Shipment, COD collection, delivery attempts |

Staff login: `/staff-login` (admin host) · Logistics login: `/logistics-login` (logistics host).

Logistics UI requires a valid staff JWT (`avyora_access`). Never enable `NEXT_PUBLIC_ALLOW_DEMO_STAFF_LOGIN` in production.

---

## Quick start (local)

```bash
cd avyora
cp .env.example .env.local
# set DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET
npm install
npx prisma migrate deploy
# Seed only on an EMPTY database (requires ADMIN_SEED_PASSWORD):
# ADMIN_SEED_PASSWORD='your-strong-password' npx tsx prisma/seed.ts
npm run dev:all
```

From the parent `E-commerce` folder you can also run:

```bash
npm run dev:all
npm run dev:store
npm run dev:admin
npm run dev:logistics
```

| Script | What it starts |
| --- | --- |
| `npm run dev:all` | Store 3000 + Admin 3001 + Logistics 3002 |
| `npm run dev:store` | Storefront only |
| `npm run dev:admin` | Admin only |
| `npm run dev:logistics` | Logistics only |

Visiting `/admin` on :3000 redirects to :3001; `/logistics` redirects to :3002.

### Accounts

- **Customer:** create on :3000 (password: 8+ chars with a letter and number)
- **Staff:** use accounts already provisioned in Postgres (sign in at `/staff-login` / `/logistics-login`). Passwords are bcrypt-hashed server-side — they are never embedded in the client.
- Coupons: `AVYORA10`, `FESTIVE15`, `WELCOME500`

---

## Docker (all portals + Postgres)

Requires Docker Desktop / Compose v2.

```bash
cp .env.example .env
# Required: set JWT_SECRET and JWT_REFRESH_SECRET to different 32+ char random values
# (e.g. openssl rand -base64 48). Compose refuses to start without them.
docker compose up -d --build
```

Postgres is **not** published to the host by default (only reachable as `db` on the Compose network). For Prisma Studio / GUI tools on this machine:

```bash
docker compose -f docker-compose.yml -f docker-compose.host-db.yml up -d db
# then DATABASE_URL=…@127.0.0.1:5432/…
```

This brings up:

1. **Postgres 16** (`db`)
2. **migrate** — `prisma migrate deploy` + seed (one-shot)
3. **store** :3000 · **admin** :3001 · **logistics** :3002

Shared volume `avyora_data` mounts `/app/data` (commerce.json / smtp.json).

```bash
docker compose ps
curl http://localhost:3000/api/health
npm run monitor          # or: node scripts/monitor.mjs
docker compose down
```

One-shot backup container:

```bash
docker compose --profile ops run --rm backup
```

---

## Monitoring

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Liveness + DB check (`ok`, `db`, `portal`, `uptimeSec`) |
| `GET /api/metrics` | Prometheus-style gauges (orders, customers, DB up) |

Probe all three portals:

```bash
npm run monitor
npm run monitor:watch   # every 30s
```

Compose services include a Docker `HEALTHCHECK` against `/api/health`. Optional scrape config: `monitoring/prometheus.yml`. Keep `/api/metrics` on a private network in production.

---

## Backups

```bash
# Local (needs pg_dump on PATH for Postgres dump)
npm run backup

# Docker
docker compose --profile ops run --rm backup
```

Backups land in `./backups/` as `avyora-<timestamp>.tar.gz` (Postgres custom dump + `commerce.json` / `smtp.json` when present). Retention defaults to **14 days** (`BACKUP_KEEP_DAYS` / `KEEP_DAYS`).

Restore example (Postgres):

```bash
pg_restore -h localhost -U avyora -d avyora --clean --if-exists backups/avyora-.../postgres.dump
```

---

## CI

GitHub Actions (`.github/workflows/ci.yml`) on push/PR:

1. **Lint + Vitest**
2. **Docker build** (store image)
3. **Playwright critical-path E2E** (Postgres service)

```bash
npm run lint
npm test
npm run test:qa-smoke   # needs portals running
npm run test:e2e
```

---

## Password recovery (SMTP)

Configure in **Admin → Settings → SMTP**, or via `.env.local`.

**Gmail:** App Password + `smtp.gmail.com:587`  
**Resend:** `smtp.resend.com:465`, user `resend`, password = API key

Customers use **Forgot password** on the storefront login.

---

## What ships today

- Storefront: catalogue, search, wishlist, bag, guest/signed-in checkout (COD + Razorpay when keyed)
- Admin: catalogue/orders/customers/settings; commerce writes authenticated
- Logistics: authorized shipment/COD APIs; admin PUT cannot overwrite logistics-owned fields
- Postgres/Prisma for auth, checkout, account orders, track
- Playwright E2E for checkout → logistics → track

## Production notes

- Set strong `JWT_*` secrets; keep `ALLOW_LEGACY_COMMERCE_WRITE=false`
- For `store.` / `admin.` / `logistics.` subdomains set `AUTH_COOKIE_DOMAIN` to the parent (e.g. `avyora.com`), or leave it unset to auto-derive from the three `NEXT_PUBLIC_*_ORIGIN` hosts
- Default Compose does **not** publish Postgres `:5432`; use `docker-compose.host-db.yml` only for local loopback tooling
- Put metrics/health behind your edge; do not expose Postgres ports publicly
- Prefer `docker compose` or a managed Postgres + three app replicas (store/admin/logistics images)
- Ops: SMTP powers logistics emails when configured; `COURIER_PROVIDER=manual|shiprocket`; cron via `POST /api/cron/tick` + `CRON_SECRET`
- PRD north star still includes Redis/BullMQ as an optional later stage (in-process jobs work without Redis)
