/**
 * Centralized recommendation scoring weights & blend ratios.
 * Tune here — do not scatter magic numbers through the engine.
 */

export const SCORE_WEIGHTS = {
  PRODUCT_VIEW_CATEGORY: 10,
  SEARCH_CATEGORY: 15,
  WISHLIST_CATEGORY: 20,
  CART_CATEGORY: 25,
  PURCHASE_CATEGORY: 18,
  PRICE_MATCH: 10,
  RECENCY: 10,
  POPULARITY: 5,
  SAME_METAL: 4,
  SAME_PRODUCT_CONTEXT: 12,
  COMPLEMENTARY: 8,
  ALREADY_PURCHASED_PENALTY: 40,
  ALREADY_IN_CART_PENALTY: 25,
  ALREADY_WISHLIST_PENALTY: 8,
  OUT_OF_STOCK_PENALTY: 10_000,
  DUPLICATE_PENALTY: 10_000,
} as const;

/** Cold-start / limited-history blend (percentages sum to 100). */
export const COLD_START_BLEND = {
  newUser: { popular: 80, contextual: 20, personalized: 0 },
  lightUser: { popular: 20, contextual: 30, personalized: 50 },
  activeUser: { popular: 15, contextual: 15, personalized: 70 },
} as const;

/** Events in the last N days count as "active" for blend selection. */
export const ACTIVE_USER_MIN_EVENTS = 8;
export const LIGHT_USER_MIN_EVENTS = 2;

/** Time-decay half-life in days for category affinity. */
export const AFFINITY_HALF_LIFE_DAYS = 14;

/** Max events to load when building a profile. */
export const PROFILE_EVENT_LIMIT = 400;

/** Candidate pool size before scoring. */
export const CANDIDATE_LIMIT = 120;

/** Exploration share (0–1) injected after scoring. */
export const EXPLORATION_RATIO = 0.1;

/** Max products from a single category in the final list (diversity). */
export const MAX_PER_CATEGORY = 3;

/** In-DB recommendation cache TTL (seconds). */
export const REC_CACHE_TTL_SEC = 300;
