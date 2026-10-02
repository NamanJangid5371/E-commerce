import { PERMISSIONS } from "@/server/auth/permissions";
import { AuthError, requirePermission } from "@/server/auth/rbac";
import { handleApiError, jsonError } from "@/server/http";
import {
  loadSmtpSettings,
  saveSmtpSettings,
  smtpHasStoredPassword,
  type SmtpSettingsInput,
} from "@/server/smtp-config";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function isBlankOrMask(value: unknown) {
  if (value == null) return true;
  const pass = String(value).trim();
  if (!pass) return true;
  if (/^[•*●∙]+$/.test(pass)) return true;
  return false;
}

export async function GET(request: Request) {
  try {
    await requirePermission(request, PERMISSIONS.SETTINGS_MANAGE);

    const settings = loadSmtpSettings();
    if (!settings) {
      return NextResponse.json({
        configured: false,
        settings: {
          provider: "gmail",
          host: "smtp.gmail.com",
          port: 587,
          secure: false,
          user: "",
          from: "",
          hasPassword: false,
        },
      });
    }

    return NextResponse.json({
      configured: true,
      settings: {
        provider: "gmail",
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        user: settings.user,
        from: settings.from,
        hasPassword: smtpHasStoredPassword(),
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonError(error.message, error.status);
    }
    return handleApiError(error, "smtp.settings.get");
  }
}

export async function PUT(request: Request) {
  try {
    await requirePermission(request, PERMISSIONS.SETTINGS_MANAGE);

    const body = (await request.json()) as Partial<SmtpSettingsInput> & {
      pass?: string;
      newPass?: string;
    };

    const user = body.user?.trim().toLowerCase() ?? "";
    if (!user.includes("@")) {
      return NextResponse.json({ ok: false, message: "Gmail address is required." }, { status: 400 });
    }

    const typedPass = !isBlankOrMask(body.newPass)
      ? String(body.newPass)
      : !isBlankOrMask(body.pass)
        ? String(body.pass)
        : undefined;

    const saved = saveSmtpSettings({
      user,
      from: String(body.from || `Avyora <${user}>`),
      ...(typedPass ? { pass: typedPass } : {}),
    });

    return NextResponse.json({
      ok: true,
      message: typedPass
        ? "Gmail SMTP saved. All store emails send through this account."
        : "Gmail settings saved. Existing app password was kept.",
      settings: {
        provider: "gmail",
        host: saved.host,
        port: saved.port,
        secure: saved.secure,
        user: saved.user,
        from: saved.from,
        hasPassword: true,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    console.error("[smtp settings]", error);
    const message = error instanceof Error ? error.message : "Could not save SMTP settings.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
