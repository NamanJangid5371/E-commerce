import { createHash, randomInt, timingSafeEqual } from "crypto";

const DEFAULT_TTL_MINUTES = 60;
const MAX_ATTEMPTS = 5;

export function codDeliveryOtpTtlMinutes(): number {
  const raw = Number(process.env.COD_DELIVERY_OTP_TTL_MINUTES);
  if (Number.isFinite(raw) && raw >= 5 && raw <= 24 * 60) return Math.floor(raw);
  return DEFAULT_TTL_MINUTES;
}

export function codDeliveryOtpMaxAttempts(): number {
  const raw = Number(process.env.COD_DELIVERY_OTP_MAX_ATTEMPTS);
  if (Number.isFinite(raw) && raw >= 3 && raw <= 20) return Math.floor(raw);
  return MAX_ATTEMPTS;
}

function otpPepper(): string {
  return (
    process.env.COD_DELIVERY_OTP_PEPPER?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    "avyora-cod-otp-dev-pepper"
  );
}

export function generateDeliveryOtpCode(): string {
  return String(randomInt(100000, 1000000));
}

export function hashDeliveryOtp(code: string, orderId: string): string {
  return createHash("sha256")
    .update(`${otpPepper()}:${orderId}:${code.trim()}`)
    .digest("hex");
}

export function verifyDeliveryOtpHash(code: string, orderId: string, expectedHash: string): boolean {
  const actual = hashDeliveryOtp(code, orderId);
  try {
    const a = Buffer.from(actual, "hex");
    const b = Buffer.from(expectedHash, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function deliveryOtpExpiryDate(from = new Date()): Date {
  return new Date(from.getTime() + codDeliveryOtpTtlMinutes() * 60_000);
}
