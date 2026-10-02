# Logistics Portal — Improvement Plan

Prioritized from `LOGISTICS_AUDIT.md`. Implement in safe phases; preserve working checkout → logistics → track path.

---

## P0 — Critical

### P0.1 Unify staff auth for logistics UI + APIs

| | |
| --- | --- |
| **Problem** | UI trusts unsigned `avyora_admin` + hardcoded `avyora123`; APIs need JWT. |
| **Why it matters** | Anyone can forge client “admin” UX; mutations fail confusingly or local fallback bypasses DB. |
| **Current** | `logistics-layout.tsx`, `host.ts`, `shop-store.staffLogin`, `logistics-login/page.tsx` |
| **Solution** | Require successful staff JWT login for logistics layout; remove production password hardcode; fail closed if JWT secrets missing in production; align permission checks (`ORDER_VIEW` / `ORDER_UPDATE` ↔ UI). |
| **Files** | `logistics-layout.tsx`, `logistics-login`, `staff-login`, `shop-store.ts`, `session.ts`, `host.ts`, `middleware.ts` (optional edge check) |
| **DB** | None |
| **API** | Optional `GET /api/auth/me` for layout |
| **FE** | Gate on session probe |
| **Testing** | Auth gate E2E; unit for session fail-closed |
| **Risk** | Medium — local demo login path changes |

### P0.2 COD payment Pending until collected

| | |
| --- | --- |
| **Problem** | `checkout/place` sets COD `Payment.status = SUCCESS` before cash collected. |
| **Why it matters** | Money reporting wrong; “Mark COD collected” no-ops. |
| **Current** | `api/checkout/place/route.ts` |
| **Solution** | COD → `PENDING` + order confirmed; logistics `collectCod` / Delivered sets `SUCCESS` (already syncs). |
| **Files** | `place/route.ts`, map-order if needed, tests |
| **Risk** | Low–medium — prepaid path unchanged |

### P0.3 Prisma status mapping for exception states

| | |
| --- | --- |
| **Problem** | Failed Delivery / RTO / Return Pickup / In Transit → `toPrismaOrderStatus` null → no sync. |
| **Why it matters** | Customer `/track` and account APIs lag JSON. |
| **Solution** | Map In Transit → SHIPPED (or add enum); add Prisma enum values via migration for FAILED_DELIVERY, RTO, RETURN_PICKUP **or** store in notes + closest enum with history note. Prefer additive migration. |
| **Files** | `schema.prisma`, migration, `sync-logistics-prisma.ts`, `map-order.ts` |
| **Risk** | Medium — migration required |

### P0.4 JWT secrets fail-closed in production

| | |
| --- | --- |
| **Problem** | Default `dev-only-change-me`. |
| **Solution** | Throw/refuse boot or auth if `NODE_ENV=production` and secrets default/missing. |
| **Files** | `session.ts` |
| **Risk** | Low |

---

## P1 — High

### P1.1 Logistics status notifications

Call notify (or NotificationService) after successful status PATCH when SMTP configured; never block mutation on notify failure.

### P1.2 Server-driven order list filters + raise page size

Wire logistics orders page to API query params; increase safe pageSize; show total from server.

### P1.3 Dashboard: fetch logistics orders + COD KPIs

Mount fetch; KPIs: COD pending count/amount, failed, RTO, unassigned partner.

### P1.4 Return/RTO inventory restore (transactional)

On Returned / RTO (and optionally cancel already done), restore Prisma variant + inventory once (idempotent stock movement reason).

### P1.5 Zod-enum status on logistics PATCH/bulk

### P1.6 Expand tests

Unit: transitions, COD pending place, Prisma status map. E2E: unauthorized API, COD collect visibility.

---

## P2 — Medium

- Delivery attempts → Prisma or mirrored into track  
- Partner performance persistence  
- Audit log table for logistics actions  
- Soften +1-only transitions for selected skips (Packed→Shipped) with permission  
- UX: confirm dialogs, empty states, toast  
- Protect `/api/metrics` or document private network only  

---

## P3 — Future

- Pickup scheduling, POD, partial shipment  
- Courier SLA / delay alerts  
- AI tool APIs over controlled logistics read endpoints  
- Redis cache for dashboard aggregates  

---

## Implementation order (this engagement)

1. P0.4 JWT fail-closed  
2. P0.2 COD Pending at place  
3. P0.3 Prisma status mapping (+ migration)  
4. P0.1 Logistics auth unification (JWT session probe; remove hardcoded password from staffLogin when API available; align permissions)  
5. P1.5 Zod enum  
6. P1.2–P1.3 List filters + dashboard fetch/COD KPIs  
7. P1.1 Notify on status change  
8. P1.4 Inventory restore on Returned/RTO  
9. P1.6 Tests  
10. Docs → `LOGISTICS_FINAL_REPORT.md`

---

## Out of scope for first implementation pass

Full rewrite to Prisma-only SoT, POD, partial shipments, AI, Redis.
