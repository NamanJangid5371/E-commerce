"use client";

import { useShopStore } from "@/store/shop-store";

export default function NotificationsAdmin() {
  const ops = useShopStore((s) => s.ops);
  const setOps = useShopStore((s) => s.setOps);

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Notifications & email</h1>
      <p className="mt-1 text-sm text-ink-soft">Order, payment, shipment, return and promotional templates. Enable or disable each type.</p>
      <div className="mt-8 space-y-4">
        {ops.notifications.map((n) => (
          <div key={n.id} className="border border-line p-4">
            <div className="flex justify-between gap-4">
              <p className="font-medium">{n.event}</p>
              <button
                className="text-xs uppercase tracking-widest"
                onClick={() =>
                  setOps({
                    ...ops,
                    notifications: ops.notifications.map((x) => (x.id === n.id ? { ...x, enabled: !x.enabled } : x)),
                  })
                }
              >
                {n.enabled ? "Enabled" : "Disabled"}
              </button>
            </div>
            <input
              value={n.subject}
              onChange={(e) =>
                setOps({
                  ...ops,
                  notifications: ops.notifications.map((x) => (x.id === n.id ? { ...x, subject: e.target.value } : x)),
                })
              }
              className="mt-3 w-full border border-line bg-transparent px-3 py-2 text-sm"
            />
            <textarea
              value={n.body}
              onChange={(e) =>
                setOps({
                  ...ops,
                  notifications: ops.notifications.map((x) => (x.id === n.id ? { ...x, body: e.target.value } : x)),
                })
              }
              className="mt-2 min-h-20 w-full border border-line bg-transparent px-3 py-2 text-sm"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
