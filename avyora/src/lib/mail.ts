import nodemailer from "nodemailer";
import { loadSmtpSettings } from "@/server/smtp-config";

export function isSmtpConfigured() {
  return !!loadSmtpSettings();
}

/** Normalize secrets for known providers. */
function normalizeSmtpPass(host: string, pass: string) {
  const trimmed = pass.trim();
  if (host.toLowerCase().includes("gmail")) {
    return trimmed.replace(/\s+/g, "");
  }
  return trimmed;
}

function friendlySmtpError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: string }).code)
      : "";

  if (code === "EAUTH" || /Invalid login|BadCredentials|535/i.test(raw)) {
    return new Error(
      "Gmail rejected the username/password. Use a Google App Password (16 characters), not your normal Gmail password. Enable 2-Step Verification → Google Account → Security → App passwords.",
    );
  }
  if (code === "ESOCKET" || code === "ECONNECTION" || /ECONNREFUSED|ETIMEDOUT/i.test(raw)) {
    return new Error(
      "Could not reach the mail server. Check host/port, firewall, and that port 587 or 465 is allowed.",
    );
  }
  return error instanceof Error ? error : new Error(raw);
}

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

/**
 * Single outbound mail path for the whole app.
 * All email services (password recovery, order notify, verification,
 * appointment confirm, SMTP test) must call this — it always uses the
 * SMTP settings from Admin → Settings (or SMTP_* env).
 */
export async function sendMail(options: {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
}) {
  const config = loadSmtpSettings();
  if (!config) {
    throw new Error("SMTP is not configured. Add settings in Admin → Settings or .env.local.");
  }

  const pass = normalizeSmtpPass(config.host, config.pass);
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure && config.port === 587,
    auth: {
      user: config.user,
      pass,
    },
  });

  try {
    await transporter.verify();
    const displayFrom = config.from.includes("@")
      ? config.from
      : `Avyora <${config.user}>`;

    // Envelope from must match the authenticated Gmail mailbox.
    // Plain From + transactional headers improve Outlook/Hotmail acceptance odds.
    return await transporter.sendMail({
      from: config.user,
      replyTo: displayFrom.includes("<") ? displayFrom : `Avyora <${config.user}>`,
      sender: config.user,
      envelope: {
        from: config.user,
        to: options.to,
      },
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      priority: "high",
      headers: {
        "X-Mailer": "Avyora",
        "X-Entity-Ref-ID": `${Date.now()}`,
        "X-Priority": "1",
        Importance: "high",
        "Auto-Submitted": "auto-generated",
      },
      attachments: options.attachments?.map((file) => ({
        filename: file.filename,
        content: file.content,
        contentType: file.contentType ?? "application/octet-stream",
      })),
    });
  } catch (error) {
    throw friendlySmtpError(error);
  }
}

function brandShell(title: string, bodyHtml: string) {
  return `
    <div style="font-family: Georgia, 'Times New Roman', serif; color: #1c1612; line-height: 1.6; max-width: 520px;">
      <p style="letter-spacing: 0.2em; text-transform: uppercase; font-size: 11px; color: #8d6e4a; font-family: sans-serif;">Avyora</p>
      <h1 style="font-weight: 500; font-size: 28px; margin: 8px 0 16px;">${title}</h1>
      ${bodyHtml}
      <p style="font-size: 12px; color: #5c5248; margin-top: 28px;">— Avyora Atelier</p>
    </div>
  `;
}

export function passwordResetEmail(params: {
  name: string;
  email: string;
  code: string;
  resetUrl: string;
  expiresMinutes: number;
}) {
  // OTP-style subject improves Inbox placement (same pattern as verification).
  const subject = `Your Avyora recovery code is ${params.code}`;
  const text = [
    `Hello ${params.name},`,
    "",
    "We received a request to reset your Avyora client account password.",
    `Your 6-digit recovery code is: ${params.code}`,
    `It expires in ${params.expiresMinutes} minutes.`,
    "",
    `Or open: ${params.resetUrl}`,
    "",
    "If you did not request this, ignore this email.",
    "",
    "— Avyora",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #1c1612; line-height: 1.5; max-width: 480px;">
      <p>Hello ${escapeHtml(params.name)},</p>
      <p>Your Avyora password recovery code:</p>
      <p style="font-size: 28px; letter-spacing: 0.25em; font-weight: 700; font-family: Consolas, Monaco, monospace;">${escapeHtml(params.code)}</p>
      <p>This code expires in ${params.expiresMinutes} minutes.</p>
      <p><a href="${params.resetUrl}">Reset password</a></p>
      <p style="font-size: 12px; color: #666;">If you did not request a reset, ignore this message.</p>
    </div>
  `;

  return { subject, text, html };
}

export function verificationEmail(params: {
  name: string;
  email: string;
  code: string;
  verifyUrl: string;
  expiresMinutes: number;
}) {
  // OTP-style subject improves Outlook Inbox placement vs marketing-looking titles.
  const subject = `Your Avyora code is ${params.code}`;
  const text = [
    `Hello ${params.name},`,
    "",
    `Your Avyora email verification code is ${params.code}.`,
    `It expires in ${params.expiresMinutes} minutes.`,
    "",
    `Or open this link: ${params.verifyUrl}`,
    "",
    "If you did not create an Avyora account, ignore this message.",
    "",
    "— Avyora",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #1c1612; line-height: 1.5; max-width: 480px;">
      <p>Hello ${escapeHtml(params.name)},</p>
      <p>Your Avyora email verification code:</p>
      <p style="font-size: 28px; letter-spacing: 0.25em; font-weight: 700; font-family: Consolas, Monaco, monospace;">${escapeHtml(params.code)}</p>
      <p>This code expires in ${params.expiresMinutes} minutes.</p>
      <p><a href="${params.verifyUrl}">Verify email</a></p>
      <p style="font-size: 12px; color: #666;">If you did not create an Avyora account, ignore this message.</p>
    </div>
  `;

  return { subject, text, html };
}

export function appointmentEmail(params: {
  name: string;
  email: string;
  date: string;
  time: string;
  purpose: string;
  guests: number;
  notes?: string;
}) {
  const subject = `Avyora visit confirmed · ${params.date} ${params.time}`;
  const text = [
    `Hello ${params.name},`,
    "",
    "We have received your atelier visit request.",
    `Date: ${params.date}`,
    `Time: ${params.time}`,
    `Purpose: ${params.purpose}`,
    `Guests: ${params.guests}`,
    params.notes ? `Notes: ${params.notes}` : "",
    "",
    "We will confirm the hour by email or phone if anything changes.",
    "12 Walton Road, Bengaluru",
    "",
    "— Avyora Atelier",
  ]
    .filter(Boolean)
    .join("\n");

  const html = brandShell(
    "Visit request received",
    `
      <p>Hello ${escapeHtml(params.name)},</p>
      <p>We have received your atelier visit request for <strong>${escapeHtml(params.email)}</strong>.</p>
      <p style="margin: 20px 0; padding: 16px; border: 1px solid #e5ddd2; background: #fbf7f0;">
        <strong>${escapeHtml(params.date)}</strong> · ${escapeHtml(params.time)}<br/>
        ${escapeHtml(params.purpose)} · ${params.guests} guest${params.guests === 1 ? "" : "s"}
        ${params.notes ? `<br/><span style="color:#5c5248;">${escapeHtml(params.notes)}</span>` : ""}
      </p>
      <p style="font-size: 14px; color: #5c5248;">12 Walton Road, Bengaluru. We will confirm if anything changes.</p>
    `,
  );

  return { subject, text, html };
}

export function deliveryOtpEmail(params: {
  name: string;
  orderNumber: string;
  code: string;
  expiresMinutes: number;
  amountLabel?: string;
}) {
  const subject = `Your Avyora delivery code is ${params.code}`;
  const text = [
    `Hello ${params.name},`,
    "",
    `Your order ${params.orderNumber} is out for delivery.`,
    params.amountLabel ? `Amount due on delivery: ${params.amountLabel}.` : null,
    "",
    `Share this one-time delivery code with the courier only: ${params.code}`,
    `It expires in ${params.expiresMinutes} minutes.`,
    "",
    "Do not share this code with anyone else. The courier must enter it to complete delivery.",
    "",
    "— Avyora",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #1c1612; line-height: 1.5; max-width: 480px;">
      <p>Hello ${escapeHtml(params.name)},</p>
      <p>Your order <strong>${escapeHtml(params.orderNumber)}</strong> is out for delivery.</p>
      ${
        params.amountLabel
          ? `<p>Amount due on delivery: <strong>${escapeHtml(params.amountLabel)}</strong>.</p>`
          : ""
      }
      <p>Share this one-time delivery code with the courier only:</p>
      <p style="font-size: 28px; letter-spacing: 0.25em; font-weight: 700; font-family: Consolas, Monaco, monospace;">${escapeHtml(params.code)}</p>
      <p>This code expires in ${params.expiresMinutes} minutes.</p>
      <p style="font-size: 12px; color: #666;">Do not share this code with anyone else.</p>
    </div>
  `;

  return { subject, text, html };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
