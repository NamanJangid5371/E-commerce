import { sendMail, isSmtpConfigured } from "@/lib/mail";
import { PERMISSIONS } from "@/server/auth/permissions";
import { AuthError, requirePermission } from "@/server/auth/rbac";
import { loadSmtpSettings } from "@/server/smtp-config";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await requirePermission(request, PERMISSIONS.SETTINGS_MANAGE);

    if (!isSmtpConfigured()) {
      return NextResponse.json(
        { ok: false, message: "Save SMTP settings first." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as { to?: string };
    const to = body.to?.trim().toLowerCase() ?? "";
    if (!to.includes("@")) {
      return NextResponse.json(
        { ok: false, message: "Enter the recipient email in the Send test box." },
        { status: 400 },
      );
    }

    const cfg = loadSmtpSettings();
    const stamp = new Date().toLocaleString();
    const subject = `Avyora SMTP test · ${stamp}`;

    // Always deliver to the address from the Send test box (`to`), never the SMTP login by default.
    const info = await sendMail({
      to,
      subject,
      text: `Avyora SMTP test for ${to} at ${stamp}. Your mail settings can deliver to this address.`,
      html: `
        <div style="font-family: Georgia, serif; color: #1c1612; max-width: 480px;">
          <p style="letter-spacing: 0.2em; text-transform: uppercase; font-size: 11px; color: #8d6e4a;">Avyora</p>
          <h1 style="font-size: 24px; font-weight: 500;">SMTP test successful</h1>
          <p>This message was sent to <strong>${to}</strong> at ${stamp}.</p>
          <p style="font-size: 13px; color: #5c5248;">Search for subject: <em>${subject}</em></p>
        </div>
      `,
    });

    const accepted =
      info && typeof info === "object" && "accepted" in info
        ? (info as { accepted?: unknown }).accepted
        : undefined;
    const acceptedList = Array.isArray(accepted)
      ? accepted.map(String)
      : typeof accepted === "string"
        ? [accepted]
        : [to];

    const selfSend = !!cfg?.user && to === cfg.user.toLowerCase();
    const outlook =
      to.endsWith("@outlook.com") ||
      to.endsWith("@hotmail.com") ||
      to.endsWith("@live.com") ||
      to.endsWith("@msn.com") ||
      to.endsWith("@office365.com");

    let tip =
      " Check that inbox (and Spam/Promotions). Also open Gmail → Sent and confirm the To address is correct.";
    if (selfSend) {
      tip =
        " Same as your Gmail login — check Sent / All Mail / Spam if Inbox is empty.";
    } else if (outlook) {
      tip =
        " For Outlook: check Junk Email, Other (Focused Inbox), and Clutter. Search “Avyora”. Also confirm Gmail → Sent shows this Outlook address.";
    }

    return NextResponse.json({
      ok: true,
      to,
      subject,
      accepted: acceptedList,
      message: `Sent to ${to}. Mail server accepted: ${acceptedList.join(", ")}.${tip}`,
      messageId:
        info && typeof info === "object" && "messageId" in info
          ? String((info as { messageId?: string }).messageId ?? "")
          : undefined,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    console.error("[smtp test]", error);
    const detail = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        ok: false,
        message: `Could not send test email. ${detail}`,
      },
      { status: 500 },
    );
  }
}
