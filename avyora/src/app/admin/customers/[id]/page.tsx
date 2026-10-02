"use client";

import { fetchJson } from "@/lib/api-client";
import { useToast } from "@/components/toast";
import { formatINR } from "@/lib/format";
import { useShopStore } from "@/store/shop-store";
import type { Customer, Order } from "@/store/shop-types";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type PurchaseSummary = {
  orderCount: number;
  itemCount: number;
  lifetimeSpend: number;
  paidOrderCount: number;
  lastOrderAt: string | null;
};

type CustomerDetailResponse = {
  customer: Customer;
  orders: Order[];
  summary: PurchaseSummary;
};

function paymentLabel(order: Order) {
  if (order.paymentStatus === "Refunded" || order.status === "Refunded") return "Refunded";
  if (order.codDelivery?.paymentPaid || order.paymentStatus === "Success") return "Paid";
  return order.paymentStatus ?? "Pending";
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const decoded = decodeURIComponent(id);
  const router = useRouter();
  const { toast } = useToast();
  const storeCustomer = useShopStore((s) => s.customers.find((c) => c.id === decoded));
  const upsertCustomer = useShopStore((s) => s.upsertCustomer);
  const deleteCustomer = useShopStore((s) => s.deleteCustomer);
  const groups = useShopStore((s) => s.ops?.groups);

  const [customer, setCustomer] = useState<Customer | null>(storeCustomer ?? null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<PurchaseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [trackingQuery, setTrackingQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void (async () => {
      const res = await fetchJson<CustomerDetailResponse>(
        `/api/admin/customers/${encodeURIComponent(decoded)}`,
      );
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error || "Could not load customer.");
        setLoading(false);
        return;
      }
      setCustomer(res.data.customer);
      setOrders(res.data.orders ?? []);
      setSummary(res.data.summary);
      useShopStore.setState((s) => {
        const others = s.customers.filter((c) => c.id !== res.data.customer.id);
        return { customers: [res.data.customer, ...others] };
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [decoded]);

  const sortedOrders = useMemo(
    () => [...orders].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [orders],
  );

  const filteredOrders = useMemo(() => {
    const q = trackingQuery.trim().toLowerCase();
    if (!q) return sortedOrders;
    return sortedOrders.filter((o) => (o.trackingId ?? "").toLowerCase().includes(q));
  }, [sortedOrders, trackingQuery]);

  if (loading && !customer) {
    return <div className="text-sm text-ink-soft">Loading customer profile…</div>;
  }

  if (!customer) {
    return (
      <div>
        {error || "Customer not found."}{" "}
        <Link href="/admin/customers" className="underline">
          Back
        </Link>
      </div>
    );
  }

  function handleDelete() {
    deleteCustomer(decoded);
    toast("Customer profile deleted");
    router.push("/admin/customers");
  }

  function patchCustomer(next: Customer) {
    setCustomer(next);
    upsertCustomer(next);
  }

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium tracking-tight">{customer.name}</h1>
          <p className="mt-2 text-sm text-ink-soft">{customer.email}</p>
          {customer.phone ? <p className="mt-1 text-sm text-ink-soft">{customer.phone}</p> : null}
        </div>
        <Link href="/admin/customers" className="text-sm text-ink-soft underline underline-offset-2">
          All customers
        </Link>
      </div>

      {error ? <p className="mt-4 text-sm text-rose-800">{error}</p> : null}

      {summary ? (
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border border-line bg-paper/40 px-4 py-3">
            <p className="text-[11px] uppercase tracking-widest text-ink-soft">Orders</p>
            <p className="mt-1 text-2xl font-medium">{summary.orderCount}</p>
          </div>
          <div className="border border-line bg-paper/40 px-4 py-3">
            <p className="text-[11px] uppercase tracking-widest text-ink-soft">Items bought</p>
            <p className="mt-1 text-2xl font-medium">{summary.itemCount}</p>
          </div>
          <div className="border border-line bg-paper/40 px-4 py-3">
            <p className="text-[11px] uppercase tracking-widest text-ink-soft">Lifetime spend</p>
            <p className="mt-1 text-2xl font-medium">{formatINR(summary.lifetimeSpend)}</p>
          </div>
          <div className="border border-line bg-paper/40 px-4 py-3">
            <p className="text-[11px] uppercase tracking-widest text-ink-soft">Last order</p>
            <p className="mt-1 text-sm font-medium">
              {summary.lastOrderAt
                ? new Date(summary.lastOrderAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "—"}
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-8 grid gap-4">
        <label className="text-sm">
          Phone
          <input
            value={customer.phone ?? ""}
            onChange={(e) => patchCustomer({ ...customer, phone: e.target.value })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          />
        </label>
        <label className="text-sm">
          Status
          <select
            value={customer.status}
            onChange={(e) =>
              patchCustomer({ ...customer, status: e.target.value as "active" | "blocked" })
            }
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          >
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
          </select>
        </label>
        <label className="text-sm">
          Customer group
          <select
            value={customer.groupId ?? "g-regular"}
            onChange={(e) => patchCustomer({ ...customer, groupId: e.target.value })}
            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
          >
            {(groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Notes
          <textarea
            value={customer.notes ?? ""}
            onChange={(e) => patchCustomer({ ...customer, notes: e.target.value })}
            className="mt-1 min-h-24 w-full border border-line bg-transparent px-3 py-2"
          />
        </label>
      </div>

      <h2 className="mt-10 text-lg font-medium">Saved addresses</h2>
      <ul className="mt-3 space-y-3 text-sm">
        {(customer.addresses ?? []).map((a) => (
          <li key={a.id} className="border border-line p-3">
            <p className="font-medium">
              {a.name}
              {a.isDefault ? (
                <span className="ml-2 text-[10px] uppercase tracking-widest text-gold-deep">Default</span>
              ) : null}
            </p>
            <p className="mt-1 text-ink-soft">
              {a.line1}
              {a.line2 ? `, ${a.line2}` : ""}
              <br />
              {a.city}, {a.state} {a.pincode}
              <br />
              {a.phone}
            </p>
          </li>
        ))}
        {!(customer.addresses ?? []).length && (
          <li className="text-ink-soft">No saved addresses on this profile yet.</li>
        )}
      </ul>

      <div className="mt-10 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Purchase history</h2>
          <p className="mt-1 text-sm text-ink-soft">
            All orders placed under this account or the same email (including guest checkouts).
          </p>
        </div>
        {loading ? <p className="text-xs text-ink-soft">Refreshing…</p> : null}
      </div>

      <label className="mt-4 block text-sm">
        Search by tracking ID
        <input
          type="search"
          value={trackingQuery}
          onChange={(e) => setTrackingQuery(e.target.value)}
          placeholder="e.g. AWB / tracking number"
          className="id-mono mt-1 w-full border border-line bg-transparent px-3 py-2"
          autoComplete="off"
        />
      </label>
      {trackingQuery.trim() ? (
        <p className="mt-2 text-xs text-ink-soft">
          Showing {filteredOrders.length} of {sortedOrders.length} order
          {sortedOrders.length === 1 ? "" : "s"}
        </p>
      ) : null}

      <div className="mt-4 divide-y divide-line border border-line">
        {filteredOrders.map((o) => (
          <article key={o.id} className="px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/admin/orders/${encodeURIComponent(o.id)}`}
                  className="id-mono font-medium underline underline-offset-2"
                >
                  {o.id}
                </Link>
                <p className="mt-1 text-xs text-ink-soft">
                  {new Date(o.createdAt).toLocaleString("en-IN")} · {o.status} · {paymentLabel(o)}
                  {o.paymentMethod ? ` · ${o.paymentMethod}` : ""}
                </p>
              </div>
              <p className="font-medium">{formatINR(o.total)}</p>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
              {o.items.map((item) => (
                <li key={`${o.id}-${item.orderItemId ?? item.sku}`} className="flex justify-between gap-4">
                  <span>
                    {item.name}
                    <span className="text-xs"> · {item.sku} ×{item.quantity}</span>
                  </span>
                  <span>{formatINR(item.price * item.quantity)}</span>
                </li>
              ))}
            </ul>
            {(o.trackingId || o.deliveryPartner || o.refundedAmount) && (
              <p className="mt-2 text-xs text-ink-soft">
                {o.trackingId ? (
                  <>
                    Tracking <span className="id-mono">{o.trackingId}</span>
                  </>
                ) : (
                  "Tracking pending"
                )}
                {o.deliveryPartner ? ` · ${o.deliveryPartner}` : ""}
                {o.refundedAmount ? ` · Refunded ${formatINR(o.refundedAmount)}` : ""}
              </p>
            )}
          </article>
        ))}
        {!sortedOrders.length && (
          <p className="px-4 py-8 text-sm text-ink-soft">No purchase history for this customer yet.</p>
        )}
        {sortedOrders.length > 0 && !filteredOrders.length && (
          <p className="px-4 py-8 text-sm text-ink-soft">
            No orders match tracking ID “{trackingQuery.trim()}”.
          </p>
        )}
      </div>

      <div className="mt-12 border border-red-900/20 bg-red-50/40 p-5">
        <p className="text-[11px] tracking-[0.18em] uppercase text-red-900/70">Danger zone</p>
        <p className="mt-2 text-sm text-ink-soft">
          Delete this customer profile permanently. Past orders stay in the orders list; the account can
          no longer sign in.
        </p>
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="mt-4 border border-red-900/40 px-4 py-2 text-[11px] tracking-widest uppercase text-red-900"
          >
            Delete customer profile
          </button>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleDelete}
              className="bg-red-900 px-4 py-2 text-[11px] tracking-widest uppercase text-white"
            >
              Confirm delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="border border-line px-4 py-2 text-[11px] tracking-widest uppercase"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
