import { describe, expect, it } from "vitest";
import { trackEventSchema } from "@/server/recommendations/events";
import { RECOMMENDATION_CONTEXTS, USER_EVENT_TYPES } from "@/server/recommendations/types";

describe("recommendation contracts", () => {
  it("defines expected contexts", () => {
    expect(RECOMMENDATION_CONTEXTS).toContain("HOME");
    expect(RECOMMENDATION_CONTEXTS).toContain("PRODUCT_PAGE");
    expect(RECOMMENDATION_CONTEXTS).toContain("CART");
  });

  it("defines expected event types", () => {
    expect(USER_EVENT_TYPES).toContain("PRODUCT_VIEW");
    expect(USER_EVENT_TYPES).toContain("RECOMMENDATION_CLICK");
  });

  it("rejects invalid event payloads", () => {
    const bad = trackEventSchema.safeParse({ eventType: "HACK", productId: "x" });
    expect(bad.success).toBe(false);
  });

  it("accepts valid anonymous event payloads", () => {
    const ok = trackEventSchema.safeParse({
      eventType: "PRODUCT_VIEW",
      productId: "prod_1",
      anonId: "11111111-1111-4111-8111-111111111111",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects non-uuid anonId", () => {
    const bad = trackEventSchema.safeParse({
      eventType: "SEARCH",
      searchQuery: "gold ring",
      anonId: "not-a-uuid",
    });
    expect(bad.success).toBe(false);
  });
});
