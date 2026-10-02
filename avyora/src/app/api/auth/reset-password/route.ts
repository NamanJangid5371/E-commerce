import { hashPassword } from "@/server/auth/password";
import { consumePasswordResetToken } from "@/server/auth/password-reset";
import { prisma } from "@/server/db";
import { dbUnavailableError, isDbUnavailable } from "@/server/http";
import { logger } from "@/server/logger";
import { clientIpFromRequest, rateLimit } from "@/server/security/rate-limit";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function validatePassword(password: string) {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include at least one letter and one number.";
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const ip = clientIpFromRequest(request);
    const limited = rateLimit(`reset-password:${ip}`, 10, 15 * 60_000);
    if (!limited.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: `Too many reset attempts. Try again in ${limited.retryAfterSec}s.`,
        },
        { status: 429 },
      );
    }

    const body = (await request.json()) as {
      email?: string;
      token?: string;
      password?: string;
    };

    const email = body.email?.trim().toLowerCase() ?? "";
    const token = (body.token?.trim() ?? "").replace(/\s+/g, "");
    const password = body.password ?? "";

    if (!email.includes("@")) {
      return NextResponse.json({ ok: false, message: "Enter a valid email address." }, { status: 400 });
    }
    if (!/^\d{6}$/.test(token)) {
      return NextResponse.json(
        { ok: false, message: "Enter the 6-digit recovery code from your email." },
        { status: 400 },
      );
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ ok: false, message: passwordError }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { customer: true },
    });

    if (
      !user ||
      user.role !== "CUSTOMER" ||
      !user.active ||
      user.deletedAt ||
      !user.customer ||
      user.customer.status === "BLOCKED"
    ) {
      return NextResponse.json(
        { ok: false, message: "This recovery code is invalid or has expired." },
        { status: 400 },
      );
    }

    const resetToken = await consumePasswordResetToken(email, token);
    if (!resetToken) {
      return NextResponse.json(
        { ok: false, message: "This recovery code is invalid or has expired." },
        { status: 400 },
      );
    }

    const passwordHash = await hashPassword(password);
    const now = new Date();

    await prisma.$transaction([
      prisma.passwordResetToken.updateMany({
        where: { email, usedAt: null },
        data: { usedAt: now },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          failedLogins: 0,
          lockUntil: null,
        },
      }),
      prisma.refreshToken.deleteMany({
        where: { userId: user.id },
      }),
    ]);

    logger.info("auth.reset_password.success", { userId: user.id, email });

    return NextResponse.json({
      ok: true,
      message: "Password updated. Sign in with your new password.",
    });
  } catch (error) {
    if (isDbUnavailable(error)) {
      return dbUnavailableError();
    }
    logger.error("auth.reset_password.failed", { error: String(error) });
    return NextResponse.json(
      { ok: false, message: "We could not update your password right now. Please try again." },
      { status: 500 },
    );
  }
}
