import { appointmentEmail, isSmtpConfigured, sendMail } from "@/lib/mail";
import { hasAnyPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Appointment confirmation — uses the same SMTP config as all other mail. */
export async function POST(request: Request) {
  try {
    if (!isSmtpConfigured()) {
      return NextResponse.json({ ok: false, message: "SMTP not configured." }, { status: 503 });
    }

    const body = (await request.json()) as {
      to?: string;
      name?: string;
      date?: string;
      time?: string;
      purpose?: string;
      guests?: number;
      notes?: string;
    };

    const to = body.to?.trim().toLowerCase() ?? "";
    if (!to.includes("@") || !body.name || !body.date || !body.time) {
      return NextResponse.json({ ok: false, message: "Invalid appointment payload." }, { status: 400 });
    }

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
    }

    const sessionEmail = session.email.trim().toLowerCase();
    const staffCanNotify = hasAnyPermission(session.permissions, [
      PERMISSIONS.ORDER_VIEW,
      PERMISSIONS.ORDER_UPDATE,
      PERMISSIONS.CUSTOMER_VIEW,
      PERMISSIONS.SETTINGS_MANAGE,
    ]);
    if (!staffCanNotify && sessionEmail !== to) {
      return NextResponse.json(
        { ok: false, message: "You can only send appointment mail to your own email." },
        { status: 403 },
      );
    }

    const mail = appointmentEmail({
      name: body.name.trim(),
      email: to,
      date: body.date,
      time: body.time,
      purpose: body.purpose?.trim() || "Atelier visit",
      guests: Math.min(4, Math.max(1, Number(body.guests) || 1)),
      notes: body.notes?.trim() || undefined,
    });

    await sendMail({
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });

    return NextResponse.json({ ok: true, to });
  } catch (error) {
    console.error("[appointments/notify]", error);
    return NextResponse.json({ ok: false, message: "Could not send email." }, { status: 500 });
  }
}
