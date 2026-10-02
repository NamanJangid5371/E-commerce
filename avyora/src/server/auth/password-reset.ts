import { createHmac, randomInt } from "crypto";
import { prisma } from "@/server/db";

export const PASSWORD_RESET_EXPIRES_MINUTES = 15;

function resetPepper(): string {
  return process.env.JWT_SECRET ?? process.env.JWT_REFRESH_SECRET ?? "avyora-dev-reset-pepper";
}

/** Hash a recovery code for storage/lookup. Never persist the raw code. */
export function hashPasswordResetCode(email: string, code: string): string {
  const normalized = email.trim().toLowerCase();
  return createHmac("sha256", resetPepper())
    .update(`${normalized}:${code.replace(/\s+/g, "")}`)
    .digest("hex");
}

export function generatePasswordResetCode(): string {
  return String(randomInt(100000, 1000000));
}

export function passwordResetExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + PASSWORD_RESET_EXPIRES_MINUTES * 60_000);
}

/** Invalidate unused tokens for an email, then insert a new hashed code. */
export async function issuePasswordResetToken(email: string, code: string) {
  const normalized = email.trim().toLowerCase();
  const tokenHash = hashPasswordResetCode(normalized, code);
  const expiresAt = passwordResetExpiresAt();

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { email: normalized, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: {
        email: normalized,
        tokenHash,
        expiresAt,
      },
    }),
  ]);

  return { tokenHash, expiresAt };
}

export async function consumePasswordResetToken(email: string, code: string) {
  const normalized = email.trim().toLowerCase();
  const tokenHash = hashPasswordResetCode(normalized, code);
  const now = new Date();

  const token = await prisma.passwordResetToken.findFirst({
    where: {
      email: normalized,
      tokenHash,
      usedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!token) {
    return null;
  }

  const claimed = await prisma.passwordResetToken.updateMany({
    where: {
      id: token.id,
      usedAt: null,
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  });

  if (claimed.count !== 1) {
    return null;
  }

  return token;
}
