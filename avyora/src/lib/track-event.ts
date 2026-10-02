/**
 * Client-side behavioral event tracker.
 * Dedupes React re-renders; never sends userId (server derives from session).
 */

export const CLIENT_EVENT_TYPES = [
  "PRODUCT_VIEW",
  "PRODUCT_CLICK",
  "SEARCH",
  "ADD_TO_CART",
  "REMOVE_FROM_CART",
  "WISHLIST_ADD",
  "WISHLIST_REMOVE",
  "PURCHASE",
  "RECOMMENDATION_IMPRESSION",
  "RECOMMENDATION_CLICK",
] as const;

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

const ANON_KEY = "avyora_anon_id";
const recentKeys = new Map<string, number>();
const DEDUPE_MS = 8_000;
const queue: Array<Record<string, unknown>> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `anon-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getAnonId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id || id.length < 8) {
      id = uuid();
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return uuid();
  }
}

function dedupeKey(eventType: string, productId?: string, searchQuery?: string): string {
  return `${eventType}:${productId ?? ""}:${searchQuery ?? ""}`;
}

function shouldSkip(key: string): boolean {
  const now = Date.now();
  const prev = recentKeys.get(key);
  if (prev && now - prev < DEDUPE_MS) return true;
  recentKeys.set(key, now);
  if (recentKeys.size > 200) {
    const cutoff = now - DEDUPE_MS;
    for (const [k, t] of recentKeys) {
      if (t < cutoff) recentKeys.delete(k);
    }
  }
  return false;
}

async function flush(): Promise<void> {
  const batch = queue.splice(0, 20);
  flushTimer = null;
  for (const body of batch) {
    try {
      await fetch("/api/events", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      });
    } catch {
      /* non-blocking */
    }
  }
  if (queue.length && !flushTimer) {
    flushTimer = setTimeout(() => void flush(), 400);
  }
}

export type TrackPayload = {
  eventType: ClientEventType;
  productId?: string;
  categoryId?: string;
  searchQuery?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export function trackEvent(payload: TrackPayload): void {
  if (typeof window === "undefined") return;
  const key = dedupeKey(payload.eventType, payload.productId, payload.searchQuery);
  if (shouldSkip(key)) return;

  queue.push({
    eventType: payload.eventType,
    productId: payload.productId,
    categoryId: payload.categoryId,
    searchQuery: payload.searchQuery,
    anonId: getAnonId(),
    metadata: payload.metadata,
  });

  if (!flushTimer) {
    flushTimer = setTimeout(() => void flush(), 250);
  }
}
