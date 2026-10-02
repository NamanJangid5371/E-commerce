import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "crypto";
import {
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "./razorpay";

const WEBHOOK_HMAC =
  "d796579aed123e7b743ccaf5b150affa1223e31ecba8b88c9da9ccf7ad5e0594";

describe("verifyPaymentSignature", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID = "test_key";
    process.env.RAZORPAY_KEY_SECRET = "test_secret";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects demo order ids without a valid HMAC", () => {
    const valid = verifyPaymentSignature({
      orderId: "order_demo_1234567890",
      paymentId: "pay_any",
      signature: "invalid-signature",
    });

    expect(valid).toBe(false);
  });

  it("accepts a valid payment HMAC", () => {
    const orderId = "order_real_1";
    const paymentId = "pay_real_1";
    const signature = crypto
      .createHmac("sha256", "test_secret")
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    expect(
      verifyPaymentSignature({
        orderId,
        paymentId,
        signature,
      }),
    ).toBe(true);
  });

  it("fails closed when Razorpay secret is missing", () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_ID;

    const valid = verifyPaymentSignature({
      orderId: "order_real_1",
      paymentId: "pay_real_1",
      signature: "anything",
    });

    expect(valid).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = "test_key";
    process.env.RAZORPAY_KEY_SECRET = "test_secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = "test";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("validates webhook HMAC with known secret and body", () => {
    const valid = verifyWebhookSignature("abc", WEBHOOK_HMAC);
    expect(valid).toBe(true);
  });

  it("rejects invalid webhook signature", () => {
    const valid = verifyWebhookSignature("abc", "bad-signature");
    expect(valid).toBe(false);
  });
});
