"use client";

import { fetchJson } from "@/lib/api-client";
import { formatINR } from "@/lib/format";
import { useShopStore } from "@/store/shop-store";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type RefundAlert = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  cancelReason: string | null;
  cancelledAt: string;
  amountDue: number;
  paymentMethod: string | null;
  providerPaymentId: string | null;
  products: { name: string; sku: string; quantity: number; lineTotal: number }[];
};

export default function PaymentsAdmin() {
  const orders = useShopStore((s) => s.orders);
  const ops = useShopStore((s) => s.ops);
  const setOps = useShopStore((s) => s.setOps);
  const [q, setQ] = useState("");
  const [refundAlerts, setRefundAlerts] = useState<RefundAlert[]>([]);
  const list = useMemo(
    () =>
      orders.filter((o) =>
        `${o.id} ${o.paymentId} ${o.address.name} ${o.customerEmail}`.toLowerCase().includes(q.toLowerCase()),
      ),
    [orders, q],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchJson<{ alerts: RefundAlert[] }>("/api/admin/refund-queue");
      if (cancelled || !res.ok) return;
      setRefundAlerts(res.data.alerts ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Payments</h1>
      <p className="mt-1 text-sm text-ink-soft">Transaction visibility for every order. Methods are configured below.</p>

      <section className="mt-8 border border-amber-900/25 bg-amber-50/50 p-5">
        <p className="text-[11px] tracking-[0.18em] uppercase text-amber-950/70">Refund queue</p>
        <h2 className="mt-1 text-lg font-medium">Paid orders cancelled — release refund</h2>
        <p className="mt-1 text-sm text-ink-soft">
          When a customer cancels after payment succeeds, admins are notified here (and by email) to refund that
          customer for the products on the order.
        </p>
        <div className="mt-4 divide-y divide-amber-900/10 border border-amber-900/15 bg-paper/40">
          {refundAlerts.map((alert) => (
            <article key={alert.orderId} className="px-4 py-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link
                    href={`/admin/orders/${encodeURIComponent(alert.orderNumber)}`}
                    className="id-mono font-medium underline underline-offset-2"
                  >
                    {alert.orderNumber}
                  </Link>
                  <p className="mt-1 text-ink-soft">
                    {alert.customerName} · {alert.customerEmail}
                    {alert.cancelReason ? ` · “${alert.cancelReason}”` : ""}
                  </p>
                  <ul className="mt-2 space-y-0.5 text-ink-soft">
                    {alert.products.map((p) => (
                      <li key={`${alert.orderId}-${p.sku}`}>
                        {p.name} · {p.sku} ×{p.quantity} · {formatINR(p.lineTotal)}
                      </li>
                    ))}
                  </ul>
                  {alert.providerPaymentId ? (
                    <p className="id-mono mt-2 text-xs text-ink-soft">Txn: {alert.providerPaymentId}</p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="font-medium">{formatINR(alert.amountDue)}</p>
                  <p className="text-xs text-ink-soft">{alert.paymentMethod ?? "Paid"}</p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {new Date(alert.cancelledAt).toLocaleString("en-IN")}
                  </p>
                </div>
              </div>
            </article>
          ))}
          {!refundAlerts.length && (
            <p className="px-4 py-6 text-sm text-ink-soft">No paid cancellations waiting for refund.</p>
          )}
        </div>
      </section>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order or payment id" className="mt-6 w-full max-w-md border border-line bg-transparent px-3 py-2 text-sm" />
      <div className="mt-6 divide-y divide-[var(--line)] border border-line">
        {list.map((o) => (
          <Link key={o.id} href={`/admin/orders/${o.id}`} className="flex justify-between px-4 py-3 text-sm">
            <span>
              {o.id} · {o.paymentMethod ?? "Razorpay"} · {o.paymentStatus ?? "Success"}
            </span>
            <span>{formatINR(o.total)}</span>
          </Link>
        ))}
        {!list.length && <p className="px-4 py-6 text-sm text-ink-soft">No payments yet.</p>}
      </div>
      <h2 className="mt-10 text-lg font-medium">Payment methods</h2>
      <div className="mt-4 space-y-3">
        {ops.paymentMethods.map((m) => (
          <div key={m.id} className="flex items-center justify-between border border-line p-4">
            <div>
              <p className="font-medium">{m.name}</p>
              <p className="text-sm text-ink-soft">{m.details}</p>
            </div>
            <button
              className="text-xs uppercase tracking-widest"
              onClick={() =>
                setOps({
                  ...ops,
                  paymentMethods: ops.paymentMethods.map((x) => (x.id === m.id ? { ...x, enabled: !x.enabled } : x)),
                })
              }
            >
              {m.enabled ? "Disable" : "Enable"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
