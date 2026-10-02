import { describe, expect, it } from "vitest";
import {
  isTtlAutoCancel,
  ttlUnrestockReasonTag,
} from "@/server/orders/apply-payment-success";
import { PENDING_PAYMENT_CANCEL_REASON } from "@/server/orders/release-pending-payment";

describe("apply payment success helpers", () => {
  it("recognizes unpaid TTL auto-cancel reason", () => {
    expect(isTtlAutoCancel(PENDING_PAYMENT_CANCEL_REASON)).toBe(true);
    expect(isTtlAutoCancel("Cancelled by customer")).toBe(false);
    expect(isTtlAutoCancel(null)).toBe(false);
  });

  it("builds an idempotent unrestock reason tag", () => {
    expect(ttlUnrestockReasonTag("ord_abc")).toBe("pending_payment_ttl_unrestock:ord_abc");
  });
});
