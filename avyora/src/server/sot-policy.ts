/**
 * Dual-store architecture (source of truth)
 *
 * PostgreSQL (authoritative — ONLY SoT for transactional data):
 * - orders, order items, payments, refunds
 * - customers, addresses
 * - inventory / stock movements
 * - logistics / shipments
 *
 * Enforced by `src/server/sot/transactional.ts`:
 * - commerce PUT never accepts client orders/customers
 * - JSON → Postgres stock push is OFF by default (prod: always off)
 * - logistics order resolve does not use commerce.json ghost rows by default
 *
 * commerce.json (compatibility / catalog cache / appointments mirror):
 * - catalog metadata for admin Zustand UI
 * - appointments (legacy JSON store until migrated)
 * - ops settings, campaigns, coupons (admin-editable via authenticated PUT)
 * - orders/customers may be mirrored FROM Postgres for UI warmth only (PG → JSON)
 *
 * Concurrency (store + admin + logistics share one volume):
 * - All read-modify-write updates MUST use mutateCommerce()
 * - mutateCommerce takes Postgres pg_advisory_xact_lock + a shared-volume file lock
 *
 * Deprecation plan:
 * 1. Keep Postgres as SoT (current — enforced)
 * 2. Stop reading orders/customers from JSON when DB is healthy (current)
 * 3. Migrate appointments to Postgres in a future change
 * 4. Eventually remove transactional fields from commerce.json
 */
export { TRANSACTIONAL_SOT, getSotStatus } from "@/server/sot/transactional";
export const COMMERCE_JSON_ROLE = "catalog-cache-and-legacy-compat" as const;
