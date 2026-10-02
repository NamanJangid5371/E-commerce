"use client";

import { OrderTrackingTimeline } from "@/components/order-tracking-timeline";
import { ReturnTrackingTimeline } from "@/components/return-tracking-timeline";
import { cn } from "@/lib/cn";
import { formatINR } from "@/lib/format";
import type { ReturnDto } from "@/lib/returns-api";
import type { Order } from "@/store/shop-types";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Props = {
  order: Order;
  /** Item returns for this order — tab only appears when non-empty. */
  returns?: ReturnDto[];
  compact?: boolean;
  /** Optional link builder for “Open return” in the return tab. */
  returnHref?: (ret: ReturnDto) => string | null | undefined;
  className?: string;
  /** Outer shell style to match portal cards. */
  variant?: "panel" | "plain";
};

/**
 * Single tracking card with Shipment / Return switch.
 * Return tab only shows when the order has at least one product return.
 */
export function OrderTrackingCard({
  order,
  returns = [],
  compact = false,
  returnHref,
  className,
  variant = "panel",
}: Props) {
  const hasReturns = returns.length > 0;
  const [mode, setMode] = useState<"shipment" | "return">(hasReturns ? "return" : "shipment");
  const [activeReturnId, setActiveReturnId] = useState(returns[0]?.id ?? "");

  useEffect(() => {
    if (!hasReturns) {
      setMode("shipment");
      return;
    }
    if (!returns.some((r) => r.id === activeReturnId)) {
      setActiveReturnId(returns[0]!.id);
    }
  }, [hasReturns, returns, activeReturnId]);

  const activeReturn = useMemo(
    () => returns.find((r) => r.id === activeReturnId) ?? returns[0] ?? null,
    [returns, activeReturnId],
  );

  const shell =
    variant === "panel"
      ? "rounded-3xl border border-line bg-paper/60 p-5"
      : "border border-line bg-paper/50 p-5 sm:p-6";

  return (
    <section className={cn(shell, className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-gold-deep">Tracking</p>
          <h2 className="mt-1 text-lg font-medium">
            {mode === "return" && activeReturn ? "Return progress" : "Shipment progress"}
          </h2>
        </div>

        {hasReturns ? (
          <div
            className="inline-flex rounded-full border border-line bg-ivory/70 p-0.5 text-[11px] uppercase tracking-widest"
            role="tablist"
            aria-label="Tracking mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "shipment"}
              onClick={() => setMode("shipment")}
              className={cn(
                "min-h-9 rounded-full px-3.5 py-1.5 transition",
                mode === "shipment" ? "bg-primary text-ivory" : "text-ink-soft hover:text-ink",
              )}
            >
              Shipment
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "return"}
              onClick={() => setMode("return")}
              className={cn(
                "min-h-9 rounded-full px-3.5 py-1.5 transition",
                mode === "return" ? "bg-primary text-ivory" : "text-ink-soft hover:text-ink",
              )}
            >
              Return
            </button>
          </div>
        ) : null}
      </div>

      {mode === "return" && hasReturns ? (
        <div className="mt-5 space-y-4" role="tabpanel">
          {returns.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {returns.map((ret) => (
                <button
                  type="button"
                  key={ret.id}
                  onClick={() => setActiveReturnId(ret.id)}
                  className={cn(
                    "border px-3 py-1.5 text-xs transition",
                    ret.id === activeReturn?.id
                      ? "border-ink bg-ink text-ivory"
                      : "border-line text-ink-soft hover:border-ink hover:text-ink",
                  )}
                >
                  {ret.item.name}
                </button>
              ))}
            </div>
          ) : null}

          {activeReturn ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
                <div>
                  <p className="font-medium">{activeReturn.item.name}</p>
                  <p className="mt-1 text-ink-soft">
                    {activeReturn.returnNumber} · {activeReturn.item.sku} · Qty {activeReturn.quantity}
                  </p>
                  <p className="mt-1 text-ink-soft">
                    Status: {activeReturn.statusLabel} · {formatINR(activeReturn.estimatedRefundAmount)}
                  </p>
                </div>
                {returnHref?.(activeReturn) ? (
                  <Link
                    href={returnHref(activeReturn)!}
                    className="text-[11px] uppercase tracking-widest underline underline-offset-2"
                  >
                    Open return
                  </Link>
                ) : null}
              </div>
              <ReturnTrackingTimeline ret={activeReturn} framed={false} />
            </>
          ) : null}
        </div>
      ) : (
        <div className="mt-5" role="tabpanel">
          <OrderTrackingTimeline order={order} compact={compact} framed={false} />
        </div>
      )}
    </section>
  );
}
