import { isSmtpConfigured, passwordResetEmail, sendMail } from "@/lib/mail";
import {
  generatePasswordResetCode,
  issuePasswordResetToken,
  PASSWORD_RESET_EXPIRES_MINUTES,
} from "@/server/auth/password-reset";
import { prisma } from "@/server/db";
import { dbUnavailableError, isDbUnavailable } from "@/server/http";
import { logger } from "@/server/logger";
import { clientIpFromRequest, rateLimit } from "@/server/security/rate-limit";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function storefrontOrigin() {
  return process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN ?? "http://localhost:3000";
}

function requestOrigin(request: Request) {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "")
    .split(",")[0]
    ?.trim();
  if (!host) return storefrontOrigin();
  const proto = (request.headers.get("x-forwarded-proto") ?? "http").split(",")[0]?.trim() || "http";
  return `${proto}://${host}`;
}

/** Phone opened the store via the PC's Wi-Fi address, not localhost. */
function isPhoneLanUse(origin: string) {
  try {
    const name = new URL(origin).hostname.toLowerCase();
    return (
      name.startsWith("192.168.") ||
      name.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(name)
    );
  } catch {
    return false;
  }
}

function isMicrosoftMailbox(email: string) {
  return (
    email.endsWith("@outlook.com") ||
    email.endsWith("@hotmail.com") ||
    email.endsWith("@live.com") ||
    email.endsWith("@msn.com") ||
    email.endsWith("@office365.com")
  );
}

/** Local / explicit flag — Outlook often drops consumer Gmail SMTP. */
function allowInlineRecoveryCode() {
  if (process.env.AVYORA_SHOW_RECOVERY_CODE === "1") return true;
  if (process.env.NODE_ENV === "development") return true;
  return /localhost|127\.0\.0\.1/i.test(storefrontOrigin());
}

function genericSuccessMessage(email: string) {
  const outlook = isMicrosoftMailbox(email);
  let message = `If an account exists for ${email}, a 6-digit recovery code was sent.`;
  if (outlook) {
    message +=
      " Microsoft often filters Gmail into Junk / Other — search “Avyora” there, and confirm the sender Gmail → Sent.";
  } else {
    message += " If Inbox is empty, check Spam / Promotions and the sender Gmail → Sent.";
  }
  return message;
}

export async function POST(request: Request) {
  try {
    const ip = clientIpFromRequest(request);
    const limited = rateLimit(`forgot-password:${ip}`, 8, 15 * 60_000);
    if (!limited.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: `Too many recovery requests. Try again in ${limited.retryAfterSec}s.`,
        },
        { status: 429 },
      );
    }

    const body = (await request.json()) as { email?: string };
    const email = body.email?.trim().toLowerCase() ?? "";

    if (!email.includes("@")) {
      return NextResponse.json({ ok: false, message: "Enter a valid email address." }, { status: 400 });
    }

    const emailLimited = rateLimit(`forgot-password-email:${email}`, 5, 15 * 60_000);
    if (!emailLimited.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: `Too many recovery requests for this email. Try again in ${emailLimited.retryAfterSec}s.`,
        },
        { status: 429 },
      );
    }

    const origin = requestOrigin(request);
    const phoneUse = process.env.NODE_ENV === "development" && isPhoneLanUse(origin);

    if (!isSmtpConfigured() && !phoneUse) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Email recovery is not configured. In Admin → Settings, save your Gmail App Password, then try again.",
        },
        { status: 503 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { customer: true },
    });

    const eligible =
      !!user &&
      user.role === "CUSTOMER" &&
      user.active &&
      !user.deletedAt &&
      !!user.customer &&
      user.customer.status !== "BLOCKED";

    // Anti-enumeration: unknown / ineligible emails get the same success shape.
    if (!eligible) {
      return NextResponse.json({
        ok: true,
        to: email,
        message: genericSuccessMessage(email),
      });
    }

    const code = generatePasswordResetCode();
    const resetUrl = `${phoneUse ? origin : storefrontOrigin()}/login?mode=reset&email=${encodeURIComponent(email)}`;
    const mail = passwordResetEmail({
      name: user.name || "Client",
      email,
      code,
      resetUrl,
      expiresMinutes: PASSWORD_RESET_EXPIRES_MINUTES,
    });

    let emailed = false;
    if (isSmtpConfigured()) {
      try {
        await sendMail({
          to: email,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        });
        emailed = true;
      } catch (error) {
        if (!phoneUse) throw error;
        logger.error("auth.forgot_password.mail_failed_phone", { error: String(error) });
      }
    }

    await issuePasswordResetToken(email, code);

    logger.info("auth.forgot_password.sent", { email, phoneUse, emailed });

    const outlook = isMicrosoftMailbox(email);
    const showCode = phoneUse || (allowInlineRecoveryCode() && outlook);
    let message = emailed ? genericSuccessMessage(email) : "Recovery is on for this phone.";
    if (showCode) {
      message += phoneUse
        ? ` Your code is ${code}. Enter it on this screen. It expires in ${PASSWORD_RESET_EXPIRES_MINUTES} minutes.`
        : ` Local fallback code (Outlook blocked many Gmail SMTP messages): ${code}`;
    }

    return NextResponse.json({
      ok: true,
      to: email,
      message,
      ...(showCode ? { code } : {}),
    });
  } catch (error) {
    if (isDbUnavailable(error)) {
      return dbUnavailableError();
    }
    logger.error("auth.forgot_password.failed", { error: String(error) });
    const detail = error instanceof Error ? error.message : "";
    return NextResponse.json(
      {
        ok: false,
        message: detail
          ? `We could not send the recovery email. ${detail}`
          : "We could not send the recovery email right now. Please try again shortly.",
      },
      { status: 500 },
    );
  }
}
