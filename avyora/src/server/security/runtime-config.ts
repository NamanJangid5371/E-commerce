/**
 * Fail-fast production security checks (no DB access).
 * Import from server entry points / critical API modules.
 */

/** Documented / compose placeholders that must never be used in production. */
const WEAK_JWT_SECRETS = new Set([
  "dev-only-change-me",
  "change-me-docker-jwt-secret-32chars",
  "change-me-docker-refresh-secret-32",
  "change-me-to-a-long-random-string-at-least-32-chars",
  "change-me-to-another-long-random-string-32",
]);

export function isWeakJwtSecret(value: string | undefined | null): boolean {
  const secret = value?.trim() ?? "";
  if (!secret) return true;
  if (secret.length < 32) return true;
  if (WEAK_JWT_SECRETS.has(secret)) return true;
  // Catch copy-pasted "change-me-…" placeholders from docs / examples.
  if (/change-me/i.test(secret)) return true;
  return false;
}

export function assertSecureRuntimeConfig() {
  const isProd = process.env.NODE_ENV === "production";

  if (isProd && process.env.NEXT_PUBLIC_ALLOW_DEMO_STAFF_LOGIN === "true") {
    throw new Error(
      "[security] NEXT_PUBLIC_ALLOW_DEMO_STAFF_LOGIN must not be true in production.",
    );
  }

  if (isProd && process.env.ALLOW_LEGACY_COMMERCE_WRITE === "true") {
    throw new Error(
      "[security] ALLOW_LEGACY_COMMERCE_WRITE must not be true in production.",
    );
  }

  if (isProd) {
    const jwt = process.env.JWT_SECRET?.trim();
    const refresh = process.env.JWT_REFRESH_SECRET?.trim();
    if (isWeakJwtSecret(jwt)) {
      throw new Error(
        "[security] JWT_SECRET must be a strong unique secret (32+ chars); placeholders like change-me-* are rejected.",
      );
    }
    if (isWeakJwtSecret(refresh)) {
      throw new Error(
        "[security] JWT_REFRESH_SECRET must be a strong unique secret (32+ chars); placeholders like change-me-* are rejected.",
      );
    }
    if (jwt === refresh) {
      throw new Error(
        "[security] JWT_SECRET and JWT_REFRESH_SECRET must be different values.",
      );
    }
  }
}

export function isLegacyCommerceWriteEnabled() {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.ALLOW_LEGACY_COMMERCE_WRITE === "true";
}

export function isDemoStaffLoginEnabled() {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.NEXT_PUBLIC_ALLOW_DEMO_STAFF_LOGIN === "true";
}
