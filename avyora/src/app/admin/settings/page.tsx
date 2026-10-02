"use client";

import { useToast } from "@/components/toast";
import { useShopStore } from "@/store/shop-store";
import { FormEvent, useEffect, useMemo, useState } from "react";

type TabId = "general" | "commerce" | "operations" | "email";

type SmtpForm = {
  user: string;
  pass: string;
  from: string;
  hasPassword?: boolean;
};

const TABS: { id: TabId; label: string; blurb: string }[] = [
  { id: "general", label: "General", blurb: "Brand identity and contact details shown across the store." },
  { id: "commerce", label: "Commerce", blurb: "Currency, tax, shipping threshold, and returns policy." },
  { id: "operations", label: "Operations", blurb: "Store hours and maintenance controls." },
  {
    id: "email",
    label: "Email & recovery",
    blurb:
      "All store emails send through one Gmail account (recovery, orders, verification, visits, tests). Recipients can be Outlook or any inbox.",
  },
];

const PASS_MASK = "••••••••••••••••";

const blankSmtp: SmtpForm = {
  user: "",
  pass: "",
  from: "",
};

function isPassMask(value: string) {
  return !value.trim() || /^[•*●∙]+$/.test(value.trim());
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] tracking-[0.16em] uppercase text-ink-soft">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1.5 text-xs text-ink-soft">{hint}</p>}
    </label>
  );
}

const inputClass = "w-full border border-line bg-paper/40 px-3.5 py-2.5 text-sm outline-none transition focus:border-ink";

export default function SettingsAdmin() {
  const ops = useShopStore((s) => s.ops);
  const setOps = useShopStore((s) => s.setOps);
  const { toast } = useToast();

  const [tab, setTab] = useState<TabId>("general");
  const [draft, setDraft] = useState(ops?.settings ?? null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [smtp, setSmtp] = useState<SmtpForm>(blankSmtp);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [smtpMsg, setSmtpMsg] = useState("");
  const [smtpErr, setSmtpErr] = useState("");
  const [testTo, setTestTo] = useState("");
  const [smtpBusy, setSmtpBusy] = useState(false);

  useEffect(() => {
    if (ops?.settings) {
      setDraft(ops.settings);
      setDirty(false);
    }
  }, [ops?.settings]);

  useEffect(() => {
    void fetch("/api/smtp", { credentials: "include" })
      .then((r) => r.json())
      .then((data: { configured?: boolean; settings?: SmtpForm }) => {
        setSmtpConfigured(Boolean(data.configured));
        if (data.settings) {
          const hasPassword = Boolean(data.settings.hasPassword ?? data.configured);
          setSmtp({
            user: data.settings.user || "",
            from: data.settings.from || (data.settings.user ? `Avyora <${data.settings.user}>` : ""),
            pass: hasPassword ? PASS_MASK : "",
            hasPassword,
          });
        }
      })
      .catch(() => undefined);
  }, []);

  const activeTab = useMemo(() => TABS.find((t) => t.id === tab)!, [tab]);

  if (!ops?.settings || !draft) {
    return <p className="text-sm text-ink-soft">Loading settings…</p>;
  }

  function patchDraft(partial: Partial<NonNullable<typeof draft>>) {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));
    setDirty(true);
  }

  function saveStoreSettings() {
    if (!draft || !ops) return;
    setSaving(true);
    setOps({ ...ops, settings: draft });
    setDirty(false);
    setSaving(false);
    toast("Settings saved");
  }

  async function saveSmtp(e: FormEvent) {
    e.preventDefault();
    setSmtpBusy(true);
    setSmtpMsg("");
    setSmtpErr("");
    try {
      const user = smtp.user.trim().toLowerCase();
      if (!user.endsWith("@gmail.com") && !user.endsWith("@googlemail.com")) {
        setSmtpErr("Use a Gmail address (@gmail.com) as the sender.");
        setSmtpBusy(false);
        return;
      }

      const typedPass = isPassMask(smtp.pass) ? "" : smtp.pass.trim();
      const from = smtp.from.trim() || `Avyora <${user}>`;
      const payload: Record<string, unknown> = { user, from };
      if (typedPass) payload.newPass = typedPass;

      const res = await fetch("/api/smtp", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; settings?: SmtpForm };
      if (!res.ok || !data.ok) {
        setSmtpErr(data.message || "Could not save SMTP settings.");
      } else {
        setSmtpConfigured(true);
        setSmtpMsg(data.message || "Gmail SMTP saved.");
        toast("Gmail SMTP saved");
        setSmtp({
          user,
          from: data.settings?.from || from,
          pass: typedPass || PASS_MASK,
          hasPassword: true,
        });
      }
    } catch {
      setSmtpErr("Could not reach the SMTP API.");
    }
    setSmtpBusy(false);
  }

  async function sendTest() {
    const recipient = testTo.trim().toLowerCase();
    if (!recipient.includes("@")) {
      setSmtpErr("Enter the recipient email in the Send test box.");
      setSmtpMsg("");
      return;
    }

    setSmtpBusy(true);
    setSmtpMsg("");
    setSmtpErr("");
    try {
      const res = await fetch("/api/smtp/test", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: recipient }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        to?: string;
        subject?: string;
      };
      if (!res.ok || !data.ok) {
        setSmtpErr(data.message || "Test failed.");
      } else {
        const deliveredTo = data.to || recipient;
        setSmtpMsg(
          data.message ||
            `Test email sent to ${deliveredTo}${data.subject ? ` (subject: ${data.subject})` : ""}.`,
        );
        toast(`Sent to ${deliveredTo}`);
      }
    } catch {
      setSmtpErr("Could not send test email.");
    }
    setSmtpBusy(false);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-ink-soft">Configure the storefront identity, commerce rules, and email delivery.</p>
        </div>
        {tab !== "email" && (
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={saveStoreSettings}
            className="btn-primary disabled:opacity-40"
          >
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        )}
      </div>

      <div className="mt-8 flex flex-wrap gap-2 border-b border-line pb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`border px-3.5 py-2 text-[11px] tracking-[0.14em] uppercase transition ${
              tab === t.id ? "border-ink bg-ink text-ivory" : "border-line text-ink-soft hover:border-ink hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="mt-5 text-sm text-ink-soft">{activeTab.blurb}</p>

      {tab === "general" && (
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div className="space-y-5 border border-line bg-ivory/50 p-6">
            <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Brand</p>
            <Field label="Store name" hint="Appears in browser titles and invoices.">
              <input className={inputClass} value={draft.name} onChange={(e) => patchDraft({ name: e.target.value })} />
            </Field>
            <Field label="Logo text" hint="Header mark on the storefront.">
              <input className={inputClass} value={draft.logoText} onChange={(e) => patchDraft({ logoText: e.target.value })} />
            </Field>
            <Field label="Tagline">
              <input className={inputClass} value={draft.tagline} onChange={(e) => patchDraft({ tagline: e.target.value })} />
            </Field>
          </div>
          <div className="space-y-5 border border-line bg-ivory/50 p-6">
            <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Contact</p>
            <Field label="Public email">
              <input type="email" className={inputClass} value={draft.email} onChange={(e) => patchDraft({ email: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input className={inputClass} value={draft.phone} onChange={(e) => patchDraft({ phone: e.target.value })} />
            </Field>
            <Field label="WhatsApp number" hint="Digits with country code for wa.me links, e.g. 918041208800">
              <input
                className={inputClass}
                value={draft.whatsapp ?? ""}
                onChange={(e) => patchDraft({ whatsapp: e.target.value.replace(/\D/g, "") })}
                placeholder="918041208800"
              />
            </Field>
            <Field label="Atelier address">
              <textarea
                className={`${inputClass} min-h-[88px] resize-y`}
                value={draft.address}
                onChange={(e) => patchDraft({ address: e.target.value })}
              />
            </Field>
          </div>
        </div>
      )}

      {tab === "commerce" && (
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div className="space-y-5 border border-line bg-ivory/50 p-6">
            <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Pricing</p>
            <Field label="Currency code" hint="ISO code used for display (e.g. INR).">
              <input className={inputClass} value={draft.currency} onChange={(e) => patchDraft({ currency: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Tax percent" hint="Applied on eligible checkout totals.">
              <input
                type="number"
                min={0}
                step={0.1}
                className={inputClass}
                value={draft.taxPercent}
                onChange={(e) => patchDraft({ taxPercent: Number(e.target.value) })}
              />
            </Field>
          </div>
          <div className="space-y-5 border border-line bg-ivory/50 p-6">
            <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Fulfilment</p>
            <Field label="Free shipping from (₹)" hint="Orders at or above this amount ship free.">
              <input
                type="number"
                min={0}
                className={inputClass}
                value={draft.freeShippingMin}
                onChange={(e) => patchDraft({ freeShippingMin: Number(e.target.value) })}
              />
            </Field>
            <Field label="Return window (days)" hint="Shown in policies and order care copy.">
              <input
                type="number"
                min={0}
                className={inputClass}
                value={draft.returnDays}
                onChange={(e) => patchDraft({ returnDays: Number(e.target.value) })}
              />
            </Field>
          </div>
        </div>
      )}

      {tab === "operations" && (
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div className="space-y-5 border border-line bg-ivory/50 p-6">
            <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Hours</p>
            <Field label="Boutique hours" hint="Displayed in the footer and contact areas.">
              <input className={inputClass} value={draft.hours} onChange={(e) => patchDraft({ hours: e.target.value })} />
            </Field>
          </div>
          <div className="space-y-5 border border-line bg-ivory/50 p-6">
            <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Storefront status</p>
            <div className="flex items-start justify-between gap-4 border border-line bg-paper/60 px-4 py-4">
              <div>
                <p className="text-sm font-medium">Maintenance mode</p>
                <p className="mt-1 text-xs text-ink-soft">
                  Pauses checkout while you update catalogue or systems. Browse may still work.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draft.maintenance}
                onClick={() => patchDraft({ maintenance: !draft.maintenance })}
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                  draft.maintenance ? "bg-ink" : "bg-line"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-paper transition ${
                    draft.maintenance ? "left-5" : "left-0.5"
                  }`}
                />
              </button>
            </div>
            <p className={`text-xs tracking-[0.14em] uppercase ${draft.maintenance ? "text-red-800" : "text-gold-deep"}`}>
              {draft.maintenance ? "Storefront checkout paused" : "Storefront live"}
            </p>
          </div>
        </div>
      )}

      {tab === "email" && (
        <div className="mt-8 max-w-xl space-y-6">
          <form onSubmit={saveSmtp} className="space-y-5 border border-line bg-ivory/50 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Gmail connection</p>
                <p className="mt-1 text-sm text-ink-soft">Provider locked to smtp.gmail.com</p>
              </div>
              <span
                className={`border px-3 py-1 text-[10px] tracking-[0.16em] uppercase ${
                  smtpConfigured ? "border-ink bg-ink text-ivory" : "border-line text-ink-soft"
                }`}
              >
                {smtpConfigured ? "Connected" : "Not set"}
              </span>
            </div>

            <Field label="Gmail address" hint="Must be @gmail.com — this is the sender.">
              <input
                type="email"
                className={inputClass}
                value={smtp.user}
                onChange={(e) => {
                  const user = e.target.value;
                  setSmtp({
                    ...smtp,
                    user,
                    from: user.trim() ? `Avyora <${user.trim()}>` : smtp.from,
                  });
                }}
                placeholder="you@gmail.com"
                required
              />
            </Field>

            <Field
              label="Google App Password"
              hint={
                <>
                  Create at{" "}
                  <a
                    href="https://myaccount.google.com/apppasswords"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    App passwords
                  </a>{" "}
                  (2-Step Verification required).
                </>
              }
            >
              <input
                type="password"
                name="avyora-smtp-secret"
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                className={inputClass}
                value={smtp.pass}
                onFocus={() => {
                  if (isPassMask(smtp.pass)) setSmtp({ ...smtp, pass: "" });
                }}
                onBlur={() => {
                  if (!smtp.pass.trim() && smtp.hasPassword) {
                    setSmtp({ ...smtp, pass: PASS_MASK });
                  }
                }}
                onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })}
                placeholder={smtp.hasPassword ? "Saved — type to replace" : "16-character app password"}
                required={!smtp.hasPassword}
              />
            </Field>

            <Field label="From display (optional)" hint="Defaults to Avyora &lt;your@gmail.com&gt;.">
              <input
                className={inputClass}
                value={smtp.from}
                onChange={(e) => setSmtp({ ...smtp, from: e.target.value })}
                placeholder={smtp.user ? `Avyora <${smtp.user}>` : "Avyora <you@gmail.com>"}
              />
            </Field>

            <button type="submit" disabled={smtpBusy} className="btn-primary w-full disabled:opacity-50">
              {smtpBusy ? "Saving…" : "Save Gmail connection"}
            </button>
          </form>

          <div className="space-y-4 border border-line bg-ivory/50 p-6">
            <div>
              <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Send test email</p>
              <p className="mt-2 text-sm text-ink-soft">
                Recipient can be Gmail, Outlook, or any address.
              </p>
            </div>
            <Field label="Recipient email">
              <input
                type="email"
                className={inputClass}
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="someone@outlook.com"
                autoComplete="off"
              />
            </Field>
            {testTo.trim().includes("@") && (
              <p className="text-xs text-ink-soft">
                Will send to: <span className="font-medium text-ink">{testTo.trim().toLowerCase()}</span>
              </p>
            )}
            <button
              type="button"
              disabled={smtpBusy || !smtpConfigured || !testTo.trim().includes("@")}
              onClick={sendTest}
              className="btn-primary w-full disabled:opacity-40"
            >
              {smtpBusy ? "Sending…" : "Send test to this address"}
            </button>
            {smtpMsg && <p className="text-sm leading-relaxed text-ink">{smtpMsg}</p>}
            {smtpErr && <p className="text-sm leading-relaxed text-red-800">{smtpErr}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
