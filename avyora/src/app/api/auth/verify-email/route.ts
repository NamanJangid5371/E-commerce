import { loadCommerce, mutateCommerce } from "@/server/commerce-db";
import { prisma } from "@/server/db";
import { isSmtpConfigured, sendMail, verificationEmail } from "@/lib/mail";
import { randomInt } from "crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const EXPIRES_MINUTES = 30;

function storefrontOrigin() {
  return process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN ?? "http://localhost:3000";
}

function sixDigitCode() {
  return String(randomInt(100000, 1000000));
}

async function findPrismaCustomerByEmail(email: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { customer: true },
    });
    if (!user?.customer || user.customer.deletedAt) return null;
    return { user, customer: user.customer };
  } catch {
    return null;
  }
}

async function markPrismaEmailVerified(email: string) {
  try {
    await prisma.customer.updateMany({
      where: { deletedAt: null, user: { email } },
      data: { emailVerified: true },
    });
  } catch (error) {
    console.error("[verify-email] prisma update failed", error);
  }
}

/** Ensure commerce has a customer row we can attach the OTP to. */
async function ensureCommerceCustomer(input: {
  id: string;
  name: string;
  email: string;
  emailVerified?: boolean;
}) {
  await mutateCommerce((current) => {
    const idx = current.customers.findIndex((c) => c.email.toLowerCase() === input.email);
    if (idx >= 0) return current;
    return {
      ...current,
      customers: [
        ...current.customers,
        {
          id: input.id,
          name: input.name,
          email: input.email,
          createdAt: new Date().toISOString(),
          status: "active" as const,
          groupId: "g-regular",
          addresses: [],
          emailVerified: input.emailVerified ?? false,
        },
      ],
    };
  });
}

/** POST — send verification email via shared SMTP config */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string };
    const email = body.email?.trim().toLowerCase() ?? "";
    if (!email.includes("@")) {
      return NextResponse.json({ ok: false, message: "Enter a valid email address." }, { status: 400 });
    }

    if (!isSmtpConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Email is not configured. In Admin → Settings → Email, save SMTP details, then try again.",
        },
        { status: 503 },
      );
    }

    const prismaRow = await findPrismaCustomerByEmail(email);
    let commerce = loadCommerce();
    let customer = commerce.customers.find((c) => c.email.toLowerCase() === email);

    if (!customer && prismaRow) {
      await ensureCommerceCustomer({
        id: prismaRow.customer.id,
        name: prismaRow.user.name,
        email,
        emailVerified: prismaRow.customer.emailVerified,
      });
      commerce = loadCommerce();
      customer = commerce.customers.find((c) => c.email.toLowerCase() === email);
    }

    if (!customer) {
      return NextResponse.json({ ok: false, message: "Account not found." }, { status: 404 });
    }

    const alreadyVerified = customer.emailVerified || prismaRow?.customer.emailVerified;
    if (alreadyVerified) {
      if (!customer.emailVerified) {
        await mutateCommerce((current) => ({
          ...current,
          customers: current.customers.map((c) =>
            c.email.toLowerCase() === email ? { ...c, emailVerified: true } : c,
          ),
        }));
      }
      return NextResponse.json({ ok: true, message: "Your email is already verified." });
    }

    const code = sixDigitCode();
    const emailVerifyExpiresAt = new Date(Date.now() + EXPIRES_MINUTES * 60 * 1000).toISOString();
    await mutateCommerce((current) => ({
      ...current,
      customers: current.customers.map((c) =>
        c.email.toLowerCase() === email
          ? { ...c, emailVerifyToken: code, emailVerifyExpiresAt }
          : c,
      ),
    }));

    const verifyUrl = `${storefrontOrigin()}/account?verifyCode=${encodeURIComponent(code)}`;
    const mail = verificationEmail({
      name: customer.name || "Client",
      email,
      code,
      verifyUrl,
      expiresMinutes: EXPIRES_MINUTES,
    });

    await sendMail({
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });

    return NextResponse.json({
      ok: true,
      message: `Verification code sent to ${email}. Check Inbox, Junk, and Other (Outlook).`,
    });
  } catch (error) {
    console.error("[verify-email send]", error);
    return NextResponse.json(
      { ok: false, message: "Could not send verification email. Please try again shortly." },
      { status: 500 },
    );
  }
}

/** PUT — confirm verification code */
export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; code?: string };
    const email = body.email?.trim().toLowerCase() ?? "";
    const code = body.code?.trim() ?? "";
    if (!email.includes("@") || !/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { ok: false, message: "Enter your email and the 6-digit code from the message." },
        { status: 400 },
      );
    }

    const prismaRow = await findPrismaCustomerByEmail(email);
    let commerce = loadCommerce();
    let customer = commerce.customers.find((c) => c.email.toLowerCase() === email);

    if (!customer && prismaRow) {
      await ensureCommerceCustomer({
        id: prismaRow.customer.id,
        name: prismaRow.user.name,
        email,
        emailVerified: prismaRow.customer.emailVerified,
      });
      commerce = loadCommerce();
      customer = commerce.customers.find((c) => c.email.toLowerCase() === email);
    }

    if (!customer) {
      return NextResponse.json({ ok: false, message: "Account not found." }, { status: 404 });
    }

    if (customer.emailVerified || prismaRow?.customer.emailVerified) {
      await markPrismaEmailVerified(email);
      await mutateCommerce((current) => ({
        ...current,
        customers: current.customers.map((c) =>
          c.email.toLowerCase() === email
            ? {
                ...c,
                emailVerified: true,
                emailVerifyToken: undefined,
                emailVerifyExpiresAt: undefined,
              }
            : c,
        ),
      }));
      return NextResponse.json({ ok: true, message: "Your email is already verified." });
    }

    if (!customer.emailVerifyToken || customer.emailVerifyToken !== code) {
      return NextResponse.json({ ok: false, message: "That code is incorrect." }, { status: 400 });
    }
    if (customer.emailVerifyExpiresAt && new Date(customer.emailVerifyExpiresAt).getTime() < Date.now()) {
      return NextResponse.json(
        { ok: false, message: "That code has expired. Request a new one." },
        { status: 400 },
      );
    }

    await mutateCommerce((current) => ({
      ...current,
      customers: current.customers.map((c) =>
        c.email.toLowerCase() === email
          ? {
              ...c,
              emailVerified: true,
              emailVerifyToken: undefined,
              emailVerifyExpiresAt: undefined,
            }
          : c,
      ),
    }));
    await markPrismaEmailVerified(email);

    return NextResponse.json({ ok: true, message: "Email verified." });
  } catch (error) {
    console.error("[verify-email confirm]", error);
    return NextResponse.json({ ok: false, message: "Could not verify email." }, { status: 500 });
  }
}
