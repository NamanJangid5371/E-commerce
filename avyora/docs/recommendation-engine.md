# Personalized Recommendation Engine

## Architecture

```
API / Frontend
      │
      ▼
getRecommendations()  (service.ts)  ← cache via RecommendationCache
      │
      ▼
RecommendationEngine interface
      ├── RuleBasedRecommendationEngine  (current)
      └── MLRecommendationEngine         (future — not implemented)
```

Preference profiles are **computed on demand** from `UserEvent` + cart/wishlist/orders (last ~400 events, time-decayed). Results are cached ~300s in `RecommendationCache`. No separate denormalized profile table yet — add a background job when event volume warrants it.

## Event tracking

- Table: `user_events` (`UserEvent` / `UserEventType`)
- Ingest: `POST /api/events` — Zod-validated, rate-limited, **userId from session only**
- Client: `src/lib/track-event.ts` (anon UUID in localStorage, 8s dedupe, batched flush)
- Types: `PRODUCT_VIEW`, `PRODUCT_CLICK`, `SEARCH`, `ADD_TO_CART`, `REMOVE_FROM_CART`, `WISHLIST_ADD`, `WISHLIST_REMOVE`, `PURCHASE`, `RECOMMENDATION_IMPRESSION`, `RECOMMENDATION_CLICK`

## Preference calculation

`buildPreferenceProfile()` aggregates category / brand / metal scores with exponential time decay (half-life 14 days), price band from P20–P80 of observed prices (± cushions), and reason signals (browsing, search, cart, wishlist, purchase, price).

## Candidate generation

Never scores the full catalog. Pulls capped sets from preferred categories, bestsellers/featured/new, similar-to-anchor, search matches, and popular fallback (`CANDIDATE_LIMIT = 120`). Only `PUBLISHED`, non-deleted, `searchable`, in-stock products.

## Scoring

Central weights in `src/server/recommendations/weights.ts`:

| Signal | Weight |
|--------|--------|
| PRODUCT_VIEW_CATEGORY | 10 |
| SEARCH_CATEGORY | 15 |
| WISHLIST_CATEGORY | 20 |
| CART_CATEGORY | 25 |
| PURCHASE_CATEGORY | 18 |
| PRICE_MATCH | 10 |
| RECENCY | 10 |
| POPULARITY | 5 |
| Penalties | purchased 40, cart 25, wishlist 8, OOS / duplicate 10000 |

Contexts (`HOME`, `PRODUCT_PAGE`, `CART`, `CHECKOUT`, `SEARCH`, `WISHLIST`, `POST_PURCHASE`) apply additional boosts.

## Cold start

Configurable blends in `COLD_START_BLEND`:

- New user: 80% popular / 20% contextual
- Light user: 20% / 30% / 50% personalized
- Active user: 15% / 15% / 70% personalized

## Diversity & exploration

- Max 3 products per category (`MAX_PER_CATEGORY`)
- ~10% exploration slots (`EXPLORATION_RATIO`)

## API

- `GET /api/recommendations?context=HOME&limit=8&anonId=&productId=&cartIds=&wishlistIds=`
  - Auth user from cookie/session; never from query `userId`
  - Legacy: `?type=trending|similar` still supported
- `POST /api/events`
- `GET /api/admin/analytics/recommendations?days=30` — requires `REPORT_VIEW`

## Frontend

- `PersonalizedRecommendations` / `RecommendationSection` / `RecommendationCarousel` / `RecommendationCard`
- Wired on homepage, product page, cart, wishlist, search
- Empty sections render nothing

## Admin analytics

`/admin/recommendations` — impressions, clicks, CTR, conversion proxies, by-context table, top clicked products. Revenue attribution left `null` until click→order linkage is stored.

## Caching / performance

- DB cache TTL 300s keyed by hashed request
- Indexes on `user_events` (userId, anonId, eventType, productId, categoryId + createdAt)
- Rate limits on events and recommendations endpoints
- Graceful fallback to bestsellers on engine failure

## Security

- Session-derived identity only
- Validated / sanitized payloads
- Rate limiting
- Admin analytics gated by RBAC
- Public reasons are privacy-safe labels (no raw behavioral dumps)

## Testing

`src/server/recommendations/scoring.test.ts` — stock, purchase penalty, price/category affinity, diversity, reasons, cart context.

```bash
npm test -- src/server/recommendations/scoring.test.ts
```

## Future ML

Implement `MLRecommendationEngine` against `RecommendationEngine`, swap the export in `rule-engine.ts` / DI in `service.ts`. Reuse the same events table for training features.

## Migrations

```bash
npx prisma migrate deploy
npx prisma generate
```

Migration: `prisma/migrations/20260916100000_user_events`
