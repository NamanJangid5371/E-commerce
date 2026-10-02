import { describe, expect, it } from "vitest";
import {
  generatePasswordResetCode,
  hashPasswordResetCode,
  PASSWORD_RESET_EXPIRES_MINUTES,
  passwordResetExpiresAt,
} from "@/server/auth/password-reset";

describe("password-reset helpers", () => {
  it("hashes codes with email normalization", () => {
    const a = hashPasswordResetCode("Client@Avyora.com", "123456");
    const b = hashPasswordResetCode("client@avyora.com", "123456");
    const c = hashPasswordResetCode("client@avyora.com", "654321");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("ignores whitespace in codes when hashing", () => {
    expect(hashPasswordResetCode("a@b.com", "12 34 56")).toBe(
      hashPasswordResetCode("a@b.com", "123456"),
    );
  });

  it("generates a 6-digit numeric code", () => {
    for (let i = 0; i < 20; i += 1) {
      const code = generatePasswordResetCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it("expires after the configured window", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const expires = passwordResetExpiresAt(from);
    expect(expires.getTime() - from.getTime()).toBe(
      PASSWORD_RESET_EXPIRES_MINUTES * 60_000,
    );
  });
});
