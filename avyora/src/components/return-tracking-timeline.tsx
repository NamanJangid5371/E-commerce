"use client";

import { formatINR } from "@/lib/format";
import { labelReturnStatus } from "@/lib/return-labels";
import type { ReturnDto } from "@/lib/returns-api";
import type { Order } from "@/store/shop-types";
import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  CalendarClock,
  CircleCheckBig,
  ClipboardList,
  PackageCheck,
  Truck,
  Warehouse,
  XCircle,
} from "lucide-react";

type TrackerStep = {
  id: string;
  label: string;
  icon: LucideIcon;
};

/** Six-step return bar — same visual language as order progress. */
const RETURN_TRACKER_STEPS: TrackerStep[] = [
  { id: "requested", label: "Return Requested", icon: ClipboardList },
  { id: "approved", label: "Approved", icon: CircleCheckBig },
  { id: "pickup", label: "Pickup", icon: CalendarClock },
  { id: "in-transit", label: "In Transit", icon: Truck },
  { id: "warehouse", label: "At Warehouse", icon: Warehouse },
  { id: "refund", label: "Refunded", icon: Banknote },
];

/** Order-level return statuses (account cards) — shown only for return-like orders. */
const ORDER_RETURN_TRACKER_STEPS: TrackerStep[] = [
  { id: "delivered", label: "Delivered", icon: PackageCheck },
  { id: "requested", label: "Return Requested", icon: ClipboardList },
  { id: "pickup", label: "Return Pickup", icon: Truck },
  { id: "returned", label: "Returned", icon: Warehouse },
  { id: "refunded", label: "Refunded", icon: Banknote },
];

const FAILURE = new Set(["RETURN_REJECTED", "RETURN_CANCELLED", "INSPECTION_REJECTED"]);

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function returnTrackerIndex(status: string): number {
  switch (status) {
    case "RETURN_REQUESTED":
      return 0;
    case "RETURN_APPROVED":
      return 1;
    case "PICKUP_SCHEDULED":
    case "PICKED_UP":
      return 2;
    case "IN_TRANSIT":
      return 3;
    case "RECEIVED_AT_WAREHOUSE":
    case "INSPECTION_PENDING":
    case "INSPECTION_APPROVED":
    case "REFUND_ELIGIBLE":
      return 4;
    case "REFUND_INITIATED":
    case "REFUND_COMPLETED":
      return 5;
    case "RETURN_REJECTED":
    case "RETURN_CANCELLED":
      return 0;
    case "INSPECTION_REJECTED":
      return 4;
    default:
      return 0;
  }
}

function orderReturnTrackerIndex(status: Order["status"]): number {
  switch (status) {
    case "Delivered":
      return 0;
    case "Return Requested":
      return 1;
    case "Return Pickup":
      return 2;
    case "Returned":
    case "RTO":
      return 3;
    case "Refunded":
      return 4;
    default:
      return -1;
  }
}

function latestReturnStamp(ret: ReturnDto): string | null {
  return (
    ret.refundCompletedAt ??
    ret.refund?.completedAt ??
    ret.refundInitiatedAt ??
    ret.refund?.initiatedAt ??
    ret.refundEligibleAt ??
    ret.inspectionAt ??
    ret.warehouseReceivedAt ??
    ret.inTransitAt ??
    ret.pickedUpAt ??
    ret.pickupScheduledAt ??
    ret.approvedAt ??
    ret.requestedAt ??
    null
  );
}

function StepperBar({
  steps,
  currentIndex,
  complete,
  eyebrow,
  title,
  latestAt,
  latestTitle,
  latestDetail,
  alert,
  framed = true,
}: {
  steps: TrackerStep[];
  currentIndex: number;
  complete: boolean;
  eyebrow: string;
  title: string;
  latestAt?: string | null;
  latestTitle?: string | null;
  latestDetail?: string | null;
  alert?: { title: string; detail?: string | null; tone: "rose" | "amber" | "emerald" } | null;
  framed?: boolean;
}) {
  const alertClass =
    alert?.tone === "rose"
      ? "border-red-200 bg-red-50/80 text-red-900"
      : alert?.tone === "emerald"
        ? "border-emerald-200 bg-emerald-50/80 text-emerald-900"
        : "border-amber-200 bg-amber-50/80 text-amber-900";

  const frameClass = framed
    ? "rounded-[1.25rem] border border-line bg-paper/60 p-4 sm:p-5"
    : "p-0";

  return (
    <div className="space-y-5">
      {alert ? (
        <div className={`rounded-2xl border px-4 py-3 ${alertClass}`}>
          <div className="flex items-start gap-3">
            {alert.tone === "rose" ? (
              <XCircle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.8} />
            ) : (
              <CircleCheckBig className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.8} />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium">{alert.title}</p>
              {alert.detail ? <p className="mt-1 text-sm/6 opacity-80">{alert.detail}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className={frameClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">{eyebrow}</p>
            <p className="mt-1 text-lg font-medium text-ink">{title}</p>
          </div>
          {latestAt ? (
            <div className="text-right text-xs text-ink-soft">
              <p>Latest update</p>
              <time className="mt-1 block">{formatWhen(latestAt)}</time>
            </div>
          ) : null}
        </div>

        <ol
          className="mt-5 hidden gap-0 md:grid"
          style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
          aria-label="Return progress tracker"
        >
          {steps.map((step, index) => {
            const StepIcon = step.icon;
            const isComplete = index < currentIndex || (complete && index === currentIndex);
            const isCurrent = index === currentIndex && !complete;

            return (
              <li key={step.id} className="relative flex min-w-0 flex-col items-center text-center">
                {index < steps.length - 1 && (
                  <>
                    <span
                      aria-hidden
                      className="absolute left-1/2 top-5 h-[3px] w-full rounded-full bg-line"
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

        <ol className="mt-5 space-y-3 md:hidden" aria-label="Return progress tracker">
          {steps.map((step, index) => {
            const StepIcon = step.icon;
            const isComplete = index < currentIndex || (complete && index === currentIndex);
            const isCurrent = index === currentIndex && !complete;

            return (
              <li key={step.id} className="relative flex gap-3 pb-3 last:pb-0">
                {index < steps.length - 1 && (
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
                  {isCurrent ? <p className="mt-1 text-xs text-gold-deep">Current status</p> : null}
                </div>
              </li>
            );
          })}
        </ol>

        {(latestTitle || latestDetail) && (
          <div className="mt-5 rounded-2xl border border-line bg-ivory/70 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-gold-deep">Latest update</p>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
              {latestTitle ? <p className="text-sm font-medium text-ink">{latestTitle}</p> : null}
              {latestAt ? <time className="text-xs text-ink-soft">{formatWhen(latestAt)}</time> : null}
            </div>
            {latestDetail ? <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{latestDetail}</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** Item-level return progress — only render when a return DTO exists. */
export function ReturnTrackingTimeline({
  ret,
  framed = true,
}: {
  ret: ReturnDto;
  /** When false, omit the inner bordered card (parent already frames the content). */
  framed?: boolean;
}) {
  const currentIndex = returnTrackerIndex(ret.status);
  const failed = FAILURE.has(ret.status);
  const refundDone = ret.status === "REFUND_COMPLETED" || ret.refund?.status === "completed";
  const latestEvent = ret.events[0];
  const latestAt = latestEvent?.at ?? latestReturnStamp(ret);

  let alert: { title: string; detail?: string | null; tone: "rose" | "amber" | "emerald" } | null = null;
  if (failed) {
    alert = {
      title: labelReturnStatus(ret.status),
      detail: ret.rejectReason,
      tone: "rose",
    };
  } else if (refundDone && ret.refund) {
    alert = {
      title: "Refund completed",
      detail: `${formatINR(ret.refund.amount)}${ret.refund.method ? ` · ${ret.refund.method}` : ""}`,
      tone: "emerald",
    };
  }

  return (
    <StepperBar
      steps={RETURN_TRACKER_STEPS}
      currentIndex={currentIndex}
      complete={refundDone}
      eyebrow="Return progress"
      title={
        refundDone
          ? "Refunded"
          : failed
            ? labelReturnStatus(ret.status)
            : (RETURN_TRACKER_STEPS[currentIndex]?.label ?? "Return Requested")
      }
      latestAt={latestAt}
      latestTitle={latestEvent?.note ? labelReturnStatus(latestEvent.status) : labelReturnStatus(ret.status)}
      latestDetail={
        latestEvent?.note ||
        (ret.reason ? ret.reason : null) ||
        (ret.item?.name ? `${ret.item.name}${ret.quantity ? ` · Qty ${ret.quantity}` : ""}` : null)
      }
      alert={alert}
      framed={framed}
    />
  );
}

/**
 * Compact order-level return bar for account / list cards.
 * Only use when the order is in a return-like status.
 */
export function OrderReturnStatusBar({
  order,
  framed = true,
}: {
  order: Order;
  framed?: boolean;
}) {
  const currentIndex = orderReturnTrackerIndex(order.status);
  if (currentIndex < 0) return null;

  const complete = order.status === "Refunded";
  return (
    <StepperBar
      steps={ORDER_RETURN_TRACKER_STEPS}
      currentIndex={currentIndex}
      complete={complete}
      eyebrow="Return progress"
      title={ORDER_RETURN_TRACKER_STEPS[currentIndex]?.label ?? "Return"}
      latestAt={order.lastUpdatedAt ?? order.createdAt}
      latestTitle={order.status}
      latestDetail={order.returnReason ?? null}
      alert={
        order.status === "RTO"
          ? { title: "Return to origin", detail: "Shipment returning after failed delivery.", tone: "amber" }
          : null
      }
      framed={framed}
    />
  );
}
