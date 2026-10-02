"use client";

import {
  Box,
  CircleCheckBig,
  ClipboardCheck,
  Home,
  MapPinned,
  PackageCheck,
  Truck,
  XCircle,
} from "lucide-react";
import { resolveOrderTrackingEvents } from "@/lib/order-tracking";
import type { Order } from "@/store/shop-types";
import type { LucideIcon } from "lucide-react";

type Props = {
  order: Order;
  compact?: boolean;
  /** When false, omit the inner bordered card (parent already frames the content). */
  framed?: boolean;
};

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type TrackerStep = {
  id: "placed" | "confirmed" | "packed" | "shipped" | "out-for-delivery" | "delivered";
  label: string;
  icon: LucideIcon;
};

const TRACKER_STEPS: TrackerStep[] = [
  { id: "placed", label: "Order Placed", icon: ClipboardCheck },
  { id: "confirmed", label: "Confirmed", icon: CircleCheckBig },
  { id: "packed", label: "Packed", icon: PackageCheck },
  { id: "shipped", label: "Shipped", icon: Truck },
  { id: "out-for-delivery", label: "Out for Delivery", icon: MapPinned },
  { id: "delivered", label: "Delivered", icon: Home },
];

function isOutForDelivery(events: ReturnType<typeof resolveOrderTrackingEvents>) {
  return events.some(
    (event) =>
      /out for delivery/i.test(event.title) ||
      /out for delivery/i.test(event.description ?? "") ||
      /out for delivery/i.test(event.location ?? ""),
  );
}

function currentTrackerIndex(order: Order, events: ReturnType<typeof resolveOrderTrackingEvents>) {
  if (order.status === "Pending Payment") return 0;
  if (order.status === "Confirmed") return 1;
  if (order.status === "Processing") return 1;
  if (order.status === "Packed" || order.status === "Ready to Ship") return 2;
  if (order.status === "Shipped" || order.status === "In Transit") return isOutForDelivery(events) ? 4 : 3;
  if (order.status === "Out for Delivery") return 4;
  if (order.status === "Delivered") return 5;
  if (order.status === "Return Requested" || order.status === "Return Pickup" || order.status === "Returned" || order.status === "Refunded" || order.status === "RTO") return 5;
  if (order.status === "Failed Delivery") return 4;
  if (order.status === "Cancelled") {
    if (events.some((event) => event.status === "Shipped")) return 3;
    if (events.some((event) => event.status === "Packed")) return 2;
    return 1;
  }
  return 0;
}

function statusTone(order: Order) {
  if (order.status === "Cancelled") {
    return {
      icon: XCircle,
      title: "Order cancelled",
      detail: order.cancelReason || "This order was cancelled before completion.",
      className: "border-red-200 bg-red-50/80 text-red-900",
    };
  }
  if (order.status === "Refunded") {
    return {
      icon: CircleCheckBig,
      title: "Refund processed",
      detail: "This order has been refunded to the original payment method.",
      className: "border-amber-200 bg-amber-50/80 text-amber-900",
    };
  }
  if (order.status === "Return Requested") {
    return {
      icon: Box,
      title: "Return requested",
      detail: order.returnReason || "Your return request is active and the delivery remains complete.",
      className: "border-amber-200 bg-amber-50/80 text-amber-900",
    };
  }
  if (order.status === "Return Pickup" || order.status === "Returned") {
    const latest = resolveOrderTrackingEvents(order)[0];
    const stageTitle =
      latest?.title &&
      /pickup scheduled|picked up|in transit|received at warehouse|inspection/i.test(latest.title)
        ? latest.title
        : order.status === "Return Pickup"
          ? "Return pickup in progress"
          : "Returned to warehouse";
    return {
      icon: Box,
      title: stageTitle,
      detail:
        latest?.description ||
        order.returnReason ||
        (order.status === "Return Pickup"
          ? "Reverse logistics is in progress for this order."
          : "This order has been returned back to the atelier."),
      className: "border-amber-200 bg-amber-50/80 text-amber-900",
    };
  }
  if (order.status === "RTO") {
    return {
      icon: Truck,
      title: "Return to origin",
      detail: "This shipment is returning to the warehouse after a failed delivery flow.",
      className: "border-red-200 bg-red-50/80 text-red-900",
    };
  }
  if (order.status === "Failed Delivery") {
    return {
      icon: MapPinned,
      title: "Delivery attempt failed",
      detail: "A delivery attempt was not completed. The shipment will need another dispatch step.",
      className: "border-red-200 bg-red-50/80 text-red-900",
    };
  }
  return null;
}

export function OrderTrackingTimeline({ order, compact = false, framed = true }: Props) {
  const events = resolveOrderTrackingEvents(order);
  const latest = events[0];
  const currentIndex = currentTrackerIndex(order, events);
  const tone = statusTone(order);

  if (!events.length) {
    return <p className="text-sm text-ink-soft">Tracking updates will appear here once your order moves.</p>;
  }

  const frameClass = framed
    ? "rounded-[1.25rem] border border-line bg-paper/60 p-4 sm:p-5"
    : "p-0";

  return (
    <div className="space-y-5">
      {tone && (
        <div className={`rounded-2xl border px-4 py-3 ${tone.className}`}>
          <div className="flex items-start gap-3">
            <tone.icon className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.8} />
            <div className="min-w-0">
              <p className="text-sm font-medium">{tone.title}</p>
              <p className="mt-1 text-sm/6 opacity-80">{tone.detail}</p>
            </div>
          </div>
        </div>
      )}

      <div className={frameClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Order progress</p>
            <p className="mt-1 text-lg font-medium text-ink">{TRACKER_STEPS[currentIndex]?.label ?? "Order Placed"}</p>
          </div>
          {latest && (
            <div className="text-right text-xs text-ink-soft">
              <p>Latest update</p>
              <time className="mt-1 block">{formatWhen(latest.at)}</time>
            </div>
          )}
        </div>

        <ol className="mt-5 hidden grid-cols-6 gap-0 md:grid" aria-label="Order progress tracker">
          {TRACKER_STEPS.map((step, index) => {
            const StepIcon = step.icon;
            const isComplete = index < currentIndex || (order.status === "Delivered" && index === currentIndex);
            const isCurrent = index === currentIndex && order.status !== "Delivered";

            return (
              <li key={step.id} className="relative flex min-w-0 flex-col items-center text-center">
                {index < TRACKER_STEPS.length - 1 && (
                  <>
                    <span
                      aria-hidden
                      className="absolute left-1/2 top-5 h-[3px] w-full -translate-x-0 rounded-full bg-line"
                    />
                    <span
                      aria-hidden
                      className={`absolute left-1/2 top-5 h-[3px] rounded-full transition-all duration-300 ${
                        isComplete ? "w-full bg-primary" : isCurrent ? "w-1/2 bg-primary/60" : "w-0 bg-primary"
                      }`}
                    />
                  </>
                )}

                <span
                  className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-300 ${
                    isComplete
                      ? "border-primary bg-primary text-ivory shadow-[0_10px_24px_rgba(28,22,18,0.16)]"
                      : isCurrent
                        ? "border-gold-deep bg-secondary/20 text-gold-deep ring-4 ring-secondary/15"
                        : "border-line bg-paper text-ink-soft"
                  }`}
                >
                  <StepIcon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                </span>
                <p
                  className={`mt-3 max-w-[5.5rem] text-[11px] leading-4 ${
                    isComplete || isCurrent ? "font-medium text-ink" : "text-ink-soft"
                  }`}
                >
                  {step.label}
                </p>
              </li>
            );
          })}
        </ol>

        <ol className="mt-5 space-y-3 md:hidden" aria-label="Order progress tracker">
          {TRACKER_STEPS.map((step, index) => {
            const StepIcon = step.icon;
            const isComplete = index < currentIndex || (order.status === "Delivered" && index === currentIndex);
            const isCurrent = index === currentIndex && order.status !== "Delivered";

            return (
              <li key={step.id} className="relative flex gap-3 pb-3 last:pb-0">
                {index < TRACKER_STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className={`absolute left-[1.1rem] top-10 h-[calc(100%-1rem)] w-[3px] -translate-x-1/2 rounded-full ${
                      index < currentIndex ? "bg-primary" : "bg-line"
                    }`}
                  />
                )}
                <span
                  className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
                    isComplete
                      ? "border-primary bg-primary text-ivory"
                      : isCurrent
                        ? "border-gold-deep bg-secondary/20 text-gold-deep ring-4 ring-secondary/15"
                        : "border-line bg-paper text-ink-soft"
                  }`}
                >
                  <StepIcon className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <div className="min-w-0 pt-1">
                  <p className={`text-sm ${isComplete || isCurrent ? "font-medium text-ink" : "text-ink-soft"}`}>
                    {step.label}
                  </p>
                  {isCurrent && (
                    <p className="mt-1 text-xs text-gold-deep">
                      Current status
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {latest && (
          <div className="mt-5 rounded-2xl border border-line bg-ivory/70 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-gold-deep">Latest update</p>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-ink">{latest.title}</p>
              <time className="text-xs text-ink-soft">{formatWhen(latest.at)}</time>
            </div>
            {latest.location && <p className="mt-1 text-sm text-gold-deep">{latest.location}</p>}
            {latest.description && (
              <p className={`mt-1.5 text-sm leading-relaxed text-ink-soft ${compact ? "line-clamp-2" : ""}`}>
                {latest.description}
              </p>
            )}
            {(latest.updatedBy || latest.deliveryPartner) && (
              <p className="mt-1.5 text-xs text-ink-soft">
                {latest.updatedBy ? `Updated by ${latest.updatedBy}` : "Logistics update"}
                {latest.deliveryPartner ? ` · ${latest.deliveryPartner}` : ""}
              </p>
            )}
          </div>
        )}

        {!compact && events.length > 1 && (
          <div className="mt-5">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-gold-deep">Tracking history</p>
            <ol className="mt-3 space-y-3">
              {events.slice(1).map((event) => (
                <li key={event.id} className="flex gap-3 rounded-2xl border border-line/80 bg-paper/40 px-4 py-3">
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-line" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-ink">{event.title}</p>
                      <time className="text-xs text-ink-soft">{formatWhen(event.at)}</time>
                    </div>
                    {event.location && <p className="mt-1 text-sm text-gold-deep">{event.location}</p>}
                    {event.description && <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{event.description}</p>}
                    {(event.updatedBy || event.deliveryPartner) && (
                      <p className="mt-1.5 text-xs text-ink-soft">
                        {event.updatedBy ? `Updated by ${event.updatedBy}` : "Logistics update"}
                        {event.deliveryPartner ? ` · ${event.deliveryPartner}` : ""}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

export function LatestTrackingSnippet({ order }: { order: Order }) {
  const latest = resolveOrderTrackingEvents(order)[0];
  if (!latest) return null;
  return (
    <p className="mt-2 text-xs text-ink-soft">
      Latest: <span className="text-ink">{latest.title}</span>
      {latest.location ? ` · ${latest.location}` : ""}
    </p>
  );
}
