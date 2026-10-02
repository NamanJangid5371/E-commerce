"use client";

import { fetchJson } from "@/lib/api-client";
import { useEffect, useState } from "react";

type LoyaltyAccount = {
  id: string;
  balance: number;
  tier?: string | null;
  customer?: { user?: { name?: string; email?: string } };
};

export default function LoyaltyAdmin() {
  const [accounts, setAccounts] = useState<LoyaltyAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchJson<LoyaltyAccount[]>("/api/admin/loyalty");
      if (cancelled) return;
      if (res.ok) {
        setAccounts(Array.isArray(res.data) ? res.data : []);
        setOffline(false);
      } else if (res.offline) {
        setOffline(true);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Loyalty</h1>
      <p className="mt-1 text-sm text-ink-soft">Client loyalty balances and tier status.</p>

      {offline && (
        <p className="mt-6 border border-line bg-ivory/70 px-4 py-3 text-sm text-ink-soft">
          Loyalty ledger syncs when the database is online.
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-ink-soft">Loading loyalty accounts…</p>
      ) : accounts.length ? (
        <div className="mt-8 space-y-3">
          {accounts.map((account) => (
            <div key={account.id} className="border border-line p-4">
              <p className="font-medium">{account.customer?.user?.name ?? "Client"}</p>
              <p className="mt-1 text-sm text-ink-soft">
                {account.customer?.user?.email ?? "—"} · {account.balance} pts
                {account.tier ? ` · ${account.tier}` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-8 border border-line p-8 text-center">
          <p className="text-sm text-ink-soft">No loyalty accounts yet.</p>
          <p className="mt-2 text-xs text-ink-soft">Client loyalty balances will list here once the API is available.</p>
        </div>
      )}
    </div>
  );
}
