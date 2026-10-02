"use client";

import { formatINR } from "@/lib/format";
import { isCodPaymentMethod } from "@/lib/payment-method";
import { fetchLogisticsOrders } from "@/lib/logistics-api";
import {
  awaitingProcessing,
  inTransit,
  isDelayedShipment,
  readyToPack,
  readyToShip,
  statusBadgeTone,
} from "@/lib/logistics-orders";
import { fetchLogisticsReturns } from "@/lib/returns-api";
import { useShopStore } from "@/store/shop-store";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export default function LogisticsDashboardPage() {
  const orders = useShopStore((s) => s.orders);
  const mergeOrders = useShopStore((s) => s.mergeOrders);
  const partners = useShopStore((s) => s.ops.deliveryPartners);
  const [loading, setLoading] = useState(true);
  const [returnsCount, setReturnsCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [ordersRes, returnsRes] = await Promise.all([
        fetchLogisticsOrders({ pageSize: 100 }),
        fetchLogisticsReturns({ page: 1 }),
      ]);
      if (cancelled) return;
      if (ordersRes.ok && ordersRes.data?.orders?.length) mergeOrders(ordersRes.data.orders);
      if (returnsRes.ok) setReturnsCount(returnsRes.data.total);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [mergeOrders]);

  const stats = useMemo(() => {
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const yesterday = new Date(startOfToday);
    yesterday.setDate(yesterday.getDate() - 1);

    const codPending = orders.filter(
      (o) =>
        isCodPaymentMethod(o.paymentMethod) &&
        (o.paymentStatus ?? "Pending") !== "Success" &&
        o.status !== "Cancelled" &&
        o.status !== "Refunded",
    );

    return {
      total: orders.length,
      awaiting: orders.filter(awaitingProcessing).length,
      readyToPack: orders.filter(readyToPack).length,
      packed: orders.filter((o) => o.status === "Packed").length,
      readyToShip: orders.filter(readyToShip).length,
      shipped: orders.filter((o) => o.status === "Shipped").length,
      inTransit: orders.filter(inTransit).length,
      moving: orders.filter((o) => o.status === "In Transit").length,
      outForDelivery: orders.filter((o) => o.status === "Out for Delivery").length,
      delivered: orders.filter((o) => o.status === "Delivered").length,
      failedDelivery: orders.filter((o) => o.status === "Failed Delivery").length,
      rto: orders.filter((o) => o.status === "RTO").length,
      returnRequests: orders.filter((o) => o.status === "Return Requested" || o.status === "Return Pickup").length,
      returned: orders.filter((o) => o.status === "Returned" || o.status === "RTO").length,
      delayed: orders.filter((o) => isDelayedShipment(o, today)).length,
      unassigned: orders.filter(
        (o) =>
          !o.deliveryPartner &&
          o.status !== "Cancelled" &&
          o.status !== "Refunded" &&
          o.status !== "Delivered",
      ).length,
      codPendingCount: codPending.length,
      codPendingAmount: codPending.reduce((sum, o) => sum + o.total, 0),
      todayCreated: orders.filter((o) => +new Date(o.createdAt) >= +startOfToday).length,
      yesterdayCreated: orders.filter(
        (o) => +new Date(o.createdAt) >= +yesterday && +new Date(o.createdAt) < +startOfToday,
      ).length,
      todayOfd: orders.filter(
        (o) => o.status === "Out for Delivery" && +new Date(o.lastUpdatedAt ?? o.createdAt) >= +startOfToday,
      ).length,
    };
  }, [orders]);

  const returnsTotal = returnsCount || stats.returnRequests + stats.returned;

  const cards = [
    { label: "Total Orders", value: stats.total, sub: `${stats.todayCreated} today`, href: "/logistics/orders" },
    { label: "Awaiting Processing", value: stats.awaiting, sub: `${stats.readyToPack} ready to pack`, href: "/logistics/orders?queue=awaiting" },
    { label: "Packed / Ready", value: stats.packed, sub: `${stats.readyToShip} ready to hand over`, href: "/logistics/orders?queue=ship" },
    { label: "In Transit / Shipped", value: stats.inTransit, sub: `${stats.moving} in transit · ${stats.shipped} shipped`, href: "/logistics/orders?queue=transit" },
    { label: "Out for Delivery", value: stats.outForDelivery, sub: `${stats.todayOfd} updated today`, href: "/logistics/orders?queue=ofd" },
    { label: "Delivered", value: stats.delivered, sub: `${stats.returnRequests} returns open`, href: "/logistics/orders?queue=delivered" },
    {
      label: "Returns",
      value: returnsTotal,
      sub: `${stats.returnRequests} pickup queue`,
      href: "/logistics/returns",
    },
    { label: "Failed / RTO", value: stats.failedDelivery + stats.rto, sub: `${stats.rto} RTO · ${stats.failedDelivery} failed`, href: "/logistics/orders?queue=exceptions" },
    { label: "Delayed", value: stats.delayed, sub: `${stats.unassigned} unassigned partner`, href: "/logistics/orders?queue=delayed" },
    {
      label: "COD Pending",
      value: stats.codPendingCount,
      sub: formatINR(stats.codPendingAmount),
      href: "/logistics/orders?queue=cod",
    },
  ];

  const attentionOrders = useMemo(
    () =>
      [...orders]
        .sort((a, b) => {
          const delayedGap = Number(isDelayedShipment(b)) - Number(isDelayedShipment(a));
          if (delayedGap) return delayedGap;
          return +new Date(b.lastUpdatedAt ?? b.createdAt) - +new Date(a.lastUpdatedAt ?? a.createdAt);
        })
        .slice(0, 8),
    [orders],
  );

  const totalValue = useMemo(
    () =>
      orders.reduce(
        (sum, order) => sum + (order.status === "Cancelled" || order.status === "Refunded" ? 0 : order.total),
        0,
      ),
    [orders],
  );

  const partnerCards = useMemo(
    () =>
      partners
        .filter((partner) => partner.active)
        .map((partner) => {
          const partnerOrders = orders.filter((order) => order.deliveryPartner === partner.name);
          return {
            ...partner,
            shipmentCount: partnerOrders.length,
            activeShipments: partnerOrders.filter(
              (order) =>
                order.status !== "Delivered" && order.status !== "Cancelled" && order.status !== "Refunded",
            ).length,
            deliveredShipments: partnerOrders.filter((order) => order.status === "Delivered").length,
            failedDeliveries: partnerOrders.filter((order) => order.status === "Failed Delivery").length,
          };
        }),
    [orders, partners],
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">Logistics dashboard</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {loading ? "Loading fulfilment snapshot…" : "Shipment operations, COD, and exception queues."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/logistics/pack" className="border border-line px-3 py-2 text-[11px] uppercase tracking-widest">
            Packing desk
          </Link>
          <Link href="/logistics/manifest" className="border border-line px-3 py-2 text-[11px] uppercase tracking-widest">
            Courier manifest
          </Link>
        </div>
      </div>

      <p className="text-sm text-ink-soft">
        {orders.length} orders · {formatINR(totalValue)} active GMV
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ label, value, sub, href }) => (
          <Link key={label} href={href} className="rounded-3xl border border-line bg-paper/70 p-5 transition hover:border-ink">
            <p className="text-[11px] tracking-[0.16em] uppercase text-gold-deep">{label}</p>
            <p className="mt-3 text-3xl font-medium tracking-tight">{value}</p>
            <p className="mt-2 text-xs text-ink-soft">{sub}</p>
          </Link>
        ))}
      </div>

      {!!partnerCards.length && (
        <div className="rounded-3xl border border-line bg-paper/60">
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-lg font-medium">Delivery partners</h2>
            <p className="text-sm text-ink-soft">Active shipment load and outcomes by partner.</p>
          </div>
          <div className="grid gap-4 p-5 lg:grid-cols-3">
            {partnerCards.map((partner) => (
              <div key={partner.id} className="rounded-2xl border border-line bg-ivory/60 p-4">
                <p className="font-medium">{partner.name}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  {partner.shipmentCount} total · {partner.activeShipments} active · {partner.deliveredShipments}{" "}
                  delivered · {partner.failedDeliveries} failed
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-3xl border border-line bg-paper/60">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-lg font-medium">Needs attention</h2>
            <p className="text-sm text-ink-soft">Delayed and recently updated orders.</p>
          </div>
          <Link href="/logistics/orders" className="text-xs uppercase tracking-widest underline">
            All orders
          </Link>
        </div>
        <div className="divide-y divide-line">
          {attentionOrders.length === 0 && (
            <p className="px-5 py-8 text-sm text-ink-soft">No open logistics exceptions.</p>
          )}
          {attentionOrders.map((order) => (
            <Link
              key={order.id}
              href={`/logistics/orders/${order.id}`}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-ivory/50"
            >
              <div>
                <p className="font-medium">{order.id}</p>
                <p className="text-sm text-ink-soft">
                  {order.address.name} · {order.deliveryPartner ?? "Unassigned"}
                  {isCodPaymentMethod(order.paymentMethod) ? ` · COD ${order.paymentStatus ?? "Pending"}` : ""}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  statusBadgeTone(order.status) === "rose"
                    ? "bg-rose-100 text-rose-900"
                    : statusBadgeTone(order.status) === "amber"
                      ? "bg-amber-100 text-amber-900"
                      : statusBadgeTone(order.status) === "blue"
                        ? "bg-sky-100 text-sky-900"
                        : statusBadgeTone(order.status) === "emerald"
                          ? "bg-emerald-100 text-emerald-900"
                          : "bg-stone-100 text-stone-900"
                }`}
              >
                {order.status}
                {isDelayedShipment(order) ? " · Delayed" : ""}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
