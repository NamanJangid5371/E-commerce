import { afterEach, describe, expect, it } from "vitest";
import {
  codDeliveryOtpMaxAttempts,
  codDeliveryOtpTtlMinutes,
  deliveryOtpExpiryDate,
  generateDeliveryOtpCode,
  hashDeliveryOtp,
  verifyDeliveryOtpHash,
} from "@/server/cod/otp";

const ENV_KEYS = [
  "COD_DELIVERY_OTP_TTL_MINUTES",
  "COD_DELIVERY_OTP_MAX_ATTEMPTS",
  "COD_DELIVERY_OTP_PEPPER",
] as const;

const envSnapshot = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = envSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("COD delivery OTP", () => {
  it("generates a 6-digit numeric code", () => {
    const code = generateDeliveryOtpCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it("hashes and verifies with timing-safe compare", () => {
    process.env.COD_DELIVERY_OTP_PEPPER = "test-pepper";
    const code = "123456";
    const orderId = "ord_test_1";
    const hash = hashDeliveryOtp(code, orderId);
    expect(verifyDeliveryOtpHash(code, orderId, hash)).toBe(true);
    expect(verifyDeliveryOtpHash("000000", orderId, hash)).toBe(false);
    expect(verifyDeliveryOtpHash(code, "other_order", hash)).toBe(false);
  });

  it("binds hash to order id (replay across orders fails)", () => {
    process.env.COD_DELIVERY_OTP_PEPPER = "test-pepper";
    const code = "654321";
    const hashA = hashDeliveryOtp(code, "order-a");
    expect(verifyDeliveryOtpHash(code, "order-b", hashA)).toBe(false);
  });

  it("uses default TTL and attempt limits", () => {
    delete process.env.COD_DELIVERY_OTP_TTL_MINUTES;
    delete process.env.COD_DELIVERY_OTP_MAX_ATTEMPTS;
    expect(codDeliveryOtpTtlMinutes()).toBe(60);
    expect(codDeliveryOtpMaxAttempts()).toBe(5);
  });

  it("clamps TTL from env", () => {
    process.env.COD_DELIVERY_OTP_TTL_MINUTES = "30";
    expect(codDeliveryOtpTtlMinutes()).toBe(30);
    process.env.COD_DELIVERY_OTP_TTL_MINUTES = "1";
    expect(codDeliveryOtpTtlMinutes()).toBe(60);
  });

  it("computes expiry from TTL", () => {
    process.env.COD_DELIVERY_OTP_TTL_MINUTES = "15";
    const from = new Date("2026-10-01T12:00:00.000Z");
    expect(deliveryOtpExpiryDate(from).toISOString()).toBe("2026-10-01T12:15:00.000Z");
  });
});
