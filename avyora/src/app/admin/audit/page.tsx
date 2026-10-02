"use client";

import { useShopStore } from "@/store/shop-store";

export default function AuditPage() {
  const audit = useShopStore((s) => s.audit);

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Audit log</h1>
      <p className="mt-1 text-sm text-ink-soft">Sensitive catalogue and order actions recorded in this browser.</p>
      <div className="mt-8 divide-y divide-[var(--line)] border border-line">
        {audit.map((e) => (
          <div key={e.id} className="px-4 py-3 text-sm">
            <p className="font-medium">
              {e.action} · {e.detail}
            </p>
            <p className="text-ink-soft">
              {e.actor} · {new Date(e.at).toLocaleString("en-IN")}
            </p>
          </div>
        ))}
        {!audit.length && <p className="px-4 py-8 text-sm text-ink-soft">No audited actions yet.</p>}
      </div>
    </div>
  );
}
