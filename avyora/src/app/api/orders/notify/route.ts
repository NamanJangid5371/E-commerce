import { buildOrderInvoicePdf } from "@/lib/invoice-pdf";
import { isSmtpConfigured, sendMail } from "@/lib/mail";
import { hasPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest, type AuthContext } from "@/server/auth/rbac";
import { loadCommerce } from "@/server/commerce-db";
import type { Order } from "@/store/shop-types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type NotifyBody = {
  event: "order" | "ship" | "tracking";
  orderId: string;
  to: string;
  tracking?: string;
  total?: number;
  name?: string;
  templateId?: string;
  checkpoint?: string;
  location?: string;
  description?: string;
  /** Full order payload — required for invoice PDF on order confirmation. */
  order?: Order;
};

function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

function resolveTemplateId(body: NotifyBody): string {
  if (body.templateId) return body.templateId;
  if (body.event === "ship") return "n-ship";
  return "n-order";
}

function resolveOrderForInvoice(body: NotifyBody): Order | null {
  if (body.order?.id && body.order.items?.length) return body.order;

  const commerce = loadCommerce();
  const stored = commerce.orders?.find((o) => o.id === body.orderId);
  return stored ?? null;
}

function canNotify(
  session: AuthContext | null,
  body: Pick<NotifyBody, "event" | "to" | "orderId" | "order">,
): { ok: true } | { ok: false; status: number; message: string } {
  if (!session) {
    return { ok: false, status: 401, message: "Authentication required." };
  }

  const to = body.to.trim().toLowerCase();
  const staffOk =
    hasPermission(session.permissions, PERMISSIONS.ORDER_UPDATE) ||
    hasPermission(session.permissions, PERMISSIONS.ORDER_VIEW);

  if (staffOk) return { ok: true };

  // Customers may only trigger their own order-confirmation email.
  if (body.event !== "order") {
    return { ok: false, status: 403, message: "Staff access required for this notification." };
  }
  if (session.email.trim().toLowerCase() !== to) {
    return { ok: false, status: 403, message: "You can only notify your own email address." };
  }

  const orderEmail = (body.order?.customerEmail ?? "").trim().toLowerCase();
  if (orderEmail && orderEmail !== to) {
    return { ok: false, status: 403, message: "Order email does not match the signed-in account." };
  }

  return { ok: true };
}

export async function POST(request: Request) {
  try {
    if (!isSmtpConfigured()) {
      return NextResponse.json({ ok: false, message: "SMTP not configured." }, { status: 503 });
    }

    const body = (await request.json()) as NotifyBody;
    const to = body.to?.trim().toLowerCase() ?? "";
    if (!to.includes("@") || !body.orderId) {
      return NextResponse.json({ ok: false, message: "Invalid notify payload." }, { status: 400 });
    }

    const session = await getSessionFromRequest(request);
    const auth = canNotify(session, { ...body, to });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
    }

    const commerce = loadCommerce();
    const templates = commerce.ops?.notifications ?? [];
    const tplId = resolveTemplateId(body);
    const tpl = templates.find((n) => n.id === tplId && n.enabled);

    if (!tpl) {
      return NextResponse.json({ ok: true, skipped: true, message: "Template disabled." });
    }

    const vars = {
      id: body.orderId,
      tracking: body.tracking ?? "",
      total: body.total != null ? `₹${body.total.toLocaleString("en-IN")}` : "",
      name: body.name ?? "Client",
      checkpoint: body.checkpoint ?? "",
      location: body.location ?? "",
      description: body.description ?? "",
    };

    const subject = fill(tpl.subject, vars);
    const bodyText = fill(tpl.body, vars);
    const attachInvoice = body.event === "order";
    const orderForInvoice = attachInvoice ? resolveOrderForInvoice(body) : null;

    const invoiceNote = attachInvoice
      ? orderForInvoice
        ? "Your tax invoice is attached to this email as a PDF."
        : "Your tax invoice will be available in your account shortly."
      : "";

    const html = `
      <div style="font-family: Georgia, serif; color: #1c1612; max-width: 520px; line-height: 1.6;">
        <p style="letter-spacing: 0.2em; text-transform: uppercase; font-size: 11px; color: #8d6e4a;">Avyora</p>
        <h1 style="font-size: 24px; font-weight: 500;">${subject}</h1>
        <p>Hello ${vars.name},</p>
        <p>${bodyText}</p>
        ${invoiceNote ? `<p style="font-size: 14px; color: #5c5248;">${invoiceNote}</p>` : ""}
        ${
          vars.checkpoint
            ? `<p style="font-size: 14px; color: #5c5248;"><strong>${vars.checkpoint}</strong>${
                vars.location ? ` · ${vars.location}` : ""
              }</p>`
            : ""
        }
        ${vars.description ? `<p style="font-size: 14px; color: #5c5248;">${vars.description}</p>` : ""}
        <p style="font-size: 14px; color: #5c5248;">Order <strong>${vars.id}</strong>${
          vars.tracking ? ` · Tracking <strong>${vars.tracking}</strong>` : ""
        }${vars.total ? ` · ${vars.total}` : ""}</p>
        <p style="font-size: 12px; color: #5c5248;">Track live updates anytime from your Avyora account or order page.</p>
        <p style="font-size: 12px; color: #5c5248;">— Avyora Atelier</p>
      </div>
    `;

    const textLines = [bodyText, "", `Order ${vars.id}`];
    if (invoiceNote) textLines.splice(1, 0, invoiceNote, "");
    if (vars.tracking) textLines.push(`Tracking: ${vars.tracking}`);
    if (vars.total) textLines.push(`Total: ${vars.total}`);

    const attachments =
      orderForInvoice && attachInvoice
        ? [
            {
              filename: `${orderForInvoice.id}-invoice.pdf`,
              content: await buildOrderInvoicePdf(orderForInvoice, {
                customerName: vars.name,
                catalog: loadCommerce().catalog,
                store: loadCommerce().ops?.settings,
              }),
              contentType: "application/pdf",
            },
          ]
        : undefined;

    await sendMail({ to, subject, text: textLines.join("\n"), html, attachments });
    return NextResponse.json({ ok: true, invoiceAttached: Boolean(attachments?.length) });
  } catch (error) {
    console.error("[orders/notify]", error);
    return NextResponse.json({ ok: false, message: "Could not send email." }, { status: 500 });
  }
}
