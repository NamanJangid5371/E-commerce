import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { isSmtpConfigured, sendMail } from "@/lib/mail";

export type NotificationChannel = "email" | "whatsapp" | "sms";

export type NotificationPayload = {
  event: string;
  recipient: string;
  subject?: string;
  body: string;
  metadata?: Record<string, unknown>;
};

export type NotificationSendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
  skipped?: boolean;
};

export interface NotificationProvider {
  readonly name: string;
  send(payload: NotificationPayload): Promise<NotificationSendResult>;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class ConsoleEmailProvider implements NotificationProvider {
  readonly name = "console-email";

  async send(payload: NotificationPayload): Promise<NotificationSendResult> {
    const messageId = `console_email_${Date.now()}`;
    console.info("[notification:email]", {
      provider: this.name,
      messageId,
      to: payload.recipient,
      subject: payload.subject,
      body: payload.body,
      event: payload.event,
    });
    return { ok: true, messageId };
  }
}

/** Real outbound email via Admin SMTP / SMTP_* env (nodemailer). */
export class SmtpEmailProvider implements NotificationProvider {
  readonly name = "smtp";

  async send(payload: NotificationPayload): Promise<NotificationSendResult> {
    if (!isSmtpConfigured()) {
      return {
        ok: false,
        skipped: true,
        error: "SMTP is not configured (Admin → Settings or SMTP_* env).",
      };
    }

    try {
      const subject = payload.subject?.trim() || `Avyora · ${payload.event}`;
      const info = await sendMail({
        to: payload.recipient,
        subject,
        text: payload.body,
        html: `<div style="font-family:Georgia,serif;line-height:1.5;color:#1c1612">
          <p style="letter-spacing:0.18em;text-transform:uppercase;font-size:11px;color:#8d6e4a;font-family:sans-serif">Avyora</p>
          <p style="white-space:pre-wrap">${escapeHtml(payload.body)}</p>
        </div>`,
      });
      const messageId =
        info && typeof info === "object" && "messageId" in info
          ? String((info as { messageId?: string }).messageId ?? `smtp_${Date.now()}`)
          : `smtp_${Date.now()}`;
      return { ok: true, messageId };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class ConsoleWhatsAppProvider implements NotificationProvider {
  readonly name = "console-whatsapp";

  async send(payload: NotificationPayload): Promise<NotificationSendResult> {
    const messageId = `console_whatsapp_${Date.now()}`;
    console.info("[notification:whatsapp]", {
      provider: this.name,
      messageId,
      to: payload.recipient,
      body: payload.body,
      event: payload.event,
    });
    return { ok: true, messageId };
  }
}

/**
 * Meta Cloud API skeleton — only sends when WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID are set.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */
export class MetaWhatsAppProvider implements NotificationProvider {
  readonly name = "meta-whatsapp";

  async send(payload: NotificationPayload): Promise<NotificationSendResult> {
    const token = process.env.WHATSAPP_TOKEN?.trim();
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    if (!token || !phoneNumberId) {
      return {
        ok: false,
        skipped: true,
        error: "WhatsApp Meta API not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID).",
      };
    }

    const to = payload.recipient.replace(/\D/g, "");
    if (to.length < 10) {
      return { ok: false, error: "Invalid WhatsApp recipient phone." };
    }

    try {
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body: payload.body.slice(0, 4096) },
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        messages?: { id?: string }[];
        error?: { message?: string };
      };
      if (!res.ok) {
        return {
          ok: false,
          error: data.error?.message || `WhatsApp API HTTP ${res.status}`,
        };
      }
      return { ok: true, messageId: data.messages?.[0]?.id ?? `wa_${Date.now()}` };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class DisabledNotificationProvider implements NotificationProvider {
  readonly name = "disabled";

  async send(): Promise<NotificationSendResult> {
    return { ok: false, skipped: true, error: "Channel disabled." };
  }
}

export class NotificationService {
  private providers = new Map<NotificationChannel, NotificationProvider>();

  registerProvider(channel: NotificationChannel, provider: NotificationProvider): void {
    this.providers.set(channel, provider);
  }

  async send(
    channel: NotificationChannel,
    payload: NotificationPayload,
  ): Promise<NotificationSendResult> {
    const provider = this.providers.get(channel);
    if (!provider) {
      const error = `No notification provider registered for channel "${channel}".`;
      console.warn("[notification]", error, payload);
      return { ok: false, error };
    }

    const result = await provider.send(payload);

    console.info("[notification]", {
      channel,
      provider: provider.name,
      event: payload.event,
      recipient: payload.recipient,
      ok: result.ok,
      skipped: result.skipped,
      messageId: result.messageId,
      error: result.error,
    });

    try {
      const logPayload: Prisma.InputJsonValue = {
        subject: payload.subject ?? null,
        body: payload.body,
        metadata: (payload.metadata ?? null) as Prisma.InputJsonValue,
      };

      const status = result.ok ? "sent" : result.skipped ? "skipped" : "failed";

      await prisma.notificationLog.create({
        data: {
          event: payload.event,
          recipient: payload.recipient,
          channel,
          provider: provider.name,
          providerMessageId: result.messageId ?? null,
          status,
          failureReason: result.error ?? null,
          payload: logPayload,
        },
      });
    } catch (error) {
      console.warn("[notification] Could not persist NotificationLog:", error);
    }

    return result;
  }
}

function resolveEmailProvider(): NotificationProvider {
  const mode = (process.env.EMAIL_PROVIDER || "smtp").trim().toLowerCase();
  if (mode === "console") return new ConsoleEmailProvider();
  if (mode === "disabled") return new DisabledNotificationProvider();
  // Prefer real SMTP when configured; otherwise console so local/dev still logs.
  if (isSmtpConfigured()) return new SmtpEmailProvider();
  return new ConsoleEmailProvider();
}

function resolveWhatsAppProvider(): NotificationProvider {
  const mode = (process.env.WHATSAPP_PROVIDER || "console").trim().toLowerCase();
  if (mode === "disabled") return new DisabledNotificationProvider();
  if (mode === "meta") return new MetaWhatsAppProvider();
  return new ConsoleWhatsAppProvider();
}

export const notificationService = new NotificationService();

notificationService.registerProvider("email", resolveEmailProvider());
notificationService.registerProvider("whatsapp", resolveWhatsAppProvider());
