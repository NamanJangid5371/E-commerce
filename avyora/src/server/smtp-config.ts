import fs from "fs";
import path from "path";

export type SmtpSettings = {
  provider: "gmail";
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

export type SmtpSettingsInput = {
  user: string;
  from: string;
  /** Only set when the user typed a new password. Omit keeps the saved Gmail app password. */
  pass?: string;
};

type StoredFile = {
  user?: string;
  pass?: string;
  from?: string;
  // Legacy dual-slot / provider fields — ignored except gmail migration
  gmail?: { user?: string; pass?: string; from?: string };
  outlook?: unknown;
  provider?: string;
  active?: string;
  host?: string;
};

const filePath = path.join(process.cwd(), "data", "smtp.json");

const GMAIL = {
  provider: "gmail" as const,
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
};

function isBlankOrMask(value: unknown) {
  if (value == null) return true;
  const pass = String(value).trim();
  if (!pass) return true;
  if (/^[•*●∙]+$/.test(pass)) return true;
  return false;
}

function readRawFile(): StoredFile | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw) as StoredFile;
  } catch {
    return null;
  }
}

function fromStored(raw: StoredFile | null): SmtpSettings | null {
  if (!raw) return null;

  // Prefer dedicated gmail slot, then legacy flat fields (only if Gmail-looking).
  const slot = raw.gmail?.user && raw.gmail?.pass ? raw.gmail : null;
  const user = String(slot?.user || raw.user || "")
    .trim()
    .toLowerCase();
  let pass = String(slot?.pass || raw.pass || "").trim();
  if (!user || !pass) return null;

  // Drop legacy Outlook-only credentials — Gmail is the only sender.
  if (!user.endsWith("@gmail.com") && !user.endsWith("@googlemail.com")) {
    return null;
  }

  pass = pass.replace(/\s+/g, "");
  return {
    ...GMAIL,
    user,
    pass,
    from: String(slot?.from || raw.from || `Avyora <${user}>`).trim(),
  };
}

function smtpFromEnv(): SmtpSettings | null {
  const user = process.env.SMTP_USER?.trim().toLowerCase();
  const pass = process.env.SMTP_PASS?.trim();
  if (!user || !pass) return null;
  if (!user.endsWith("@gmail.com") && !user.endsWith("@googlemail.com")) return null;
  return {
    ...GMAIL,
    user,
    pass: pass.replace(/\s+/g, ""),
    from: process.env.SMTP_FROM?.trim() || `Avyora <${user}>`,
  };
}

/** Active outbound settings used by sendMail. Env wins over file. */
export function loadSmtpSettings(): SmtpSettings | null {
  return smtpFromEnv() ?? fromStored(readRawFile());
}

/**
 * Save Gmail SMTP only. Outlook SMTP is not supported.
 * Password is preserved unless a real new password is provided.
 */
export function saveSmtpSettings(input: SmtpSettingsInput): SmtpSettings {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const previous = loadSmtpSettings();
  const user = input.user.trim().toLowerCase();
  if (!user.endsWith("@gmail.com") && !user.endsWith("@googlemail.com")) {
    throw new Error("Sender must be a Gmail address (@gmail.com).");
  }

  let nextPass = isBlankOrMask(input.pass) ? previous?.pass ?? "" : String(input.pass).trim();
  if (!nextPass) {
    throw new Error("Gmail App Password is required the first time you connect.");
  }
  nextPass = nextPass.replace(/\s+/g, "");

  const payload = {
    provider: "gmail" as const,
    host: GMAIL.host,
    port: GMAIL.port,
    secure: GMAIL.secure,
    user,
    pass: nextPass,
    from: (input.from || `Avyora <${user}>`).trim(),
    // Keep a gmail slot for clarity; do not persist outlook.
    gmail: {
      user,
      pass: nextPass,
      from: (input.from || `Avyora <${user}>`).trim(),
    },
  };

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return {
    ...GMAIL,
    user: payload.user,
    pass: payload.pass,
    from: payload.from,
  };
}

export function smtpConfigured() {
  return !!loadSmtpSettings();
}

export function smtpHasStoredPassword() {
  return Boolean(loadSmtpSettings()?.pass || process.env.SMTP_PASS?.trim());
}

export function defaultsForProvider() {
  return { host: GMAIL.host, port: GMAIL.port, secure: GMAIL.secure };
}
