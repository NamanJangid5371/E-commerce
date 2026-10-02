import { describe, expect, it } from "vitest";
import {
  PENDING_PAYMENT_CANCEL_REASON,
  PENDING_PAYMENT_RESTOCK_REASON,
  pendingPaymentTtlMinutes,
  restockReasonTag,
} from "@/server/orders/release-pending-payment";

describe("pending payment release helpers", () => {
  it("builds an idempotent restock reason tag per order", () => {
    expect(restockReasonTag("ord_123")).toBe(`${PENDING_PAYMENT_RESTOCK_REASON}:ord_123`);
  });

  it("uses a stable TTL cancel reason for reopen detection", () => {
    expect(PENDING_PAYMENT_CANCEL_REASON).toContain("payment not completed");
  });

  it("defaults TTL to 30 minutes", () => {
    const prev = process.env.PENDING_PAYMENT_TTL_MINUTES;
    delete process.env.PENDING_PAYMENT_TTL_MINUTES;
    expect(pendingPaymentTtlMinutes()).toBe(30);
    if (prev === undefined) delete process.env.PENDING_PAYMENT_TTL_MINUTES;
    else process.env.PENDING_PAYMENT_TTL_MINUTES = prev;
  });

  it("accepts configured TTL within bounds", () => {
    const prev = process.env.PENDING_PAYMENT_TTL_MINUTES;
    process.env.PENDING_PAYMENT_TTL_MINUTES = "45";
    expect(pendingPaymentTtlMinutes()).toBe(45);
    process.env.PENDING_PAYMENT_TTL_MINUTES = "2";
    expect(pendingPaymentTtlMinutes()).toBe(30);
    process.env.PENDING_PAYMENT_TTL_MINUTES = "99999";
    expect(pendingPaymentTtlMinutes()).toBe(30);
    if (prev === undefined) delete process.env.PENDING_PAYMENT_TTL_MINUTES;
    else process.env.PENDING_PAYMENT_TTL_MINUTES = prev;
  });
});
