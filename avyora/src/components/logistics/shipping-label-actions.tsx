"use client";

import {
  fetchShippingLabelPdf,
  getShippingLabelPrintCount,
  hasPrintedShippingLabel,
  markShippingLabelPrinted,
  recordShippingLabelAction,
} from "@/lib/logistics-api";
import type { Order } from "@/store/shop-types";
import { useEffect, useMemo, useState } from "react";

type Props = {
  order: Order;
  className?: string;
};

export function ShippingLabelActions({ order, className }: Props) {
  const [printed, setPrinted] = useState(false);
  const [printCount, setPrintCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"preview" | "print" | "reprint">("preview");

  useEffect(() => {
    setPrinted(hasPrintedShippingLabel(order.id));
    setPrintCount(getShippingLabelPrintCount(order.id));
  }, [order.id]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const verifySummary = useMemo(
    () => ({
      orderId: order.id,
      customer: order.address.name,
      cityPin: `${order.address.city || "—"} ${order.address.pincode || ""}`.trim(),
      packageId: order.shipmentId || "Not assigned",
      tracking: order.trackingId || "Not assigned",
    }),
    [order],
  );

  function openConfirm(action: "preview" | "print" | "reprint") {
    setError("");
    setPendingAction(action);
    setConfirmOpen(true);
  }

  async function runConfirmed() {
    setBusy(true);
    setError("");

    // Always fetch fresh server-side PDF; do not trust client order fields for content.
    const res = await fetchShippingLabelPdf(order.id, "preview");
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(res.blob);
    setPreviewUrl(url);
    setConfirmOpen(false);
  }

  function handlePrintFromPreview() {
    if (!previewUrl) return;
    const w = window.open(previewUrl, "_blank", "noopener,noreferrer");
    if (!w) {
      setError("Pop-up blocked. Allow pop-ups to print the label PDF.");
      return;
    }
    window.setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        // User can print from the PDF viewer toolbar.
      }
    }, 600);

    const action = printed || printCount > 0 ? "reprint" : "print";
    markShippingLabelPrinted(order.id);
    setPrinted(true);
    setPrintCount((c) => c + 1);
    void recordShippingLabelAction(order.id, action);
  }

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => openConfirm("preview")}
          className="border border-line px-3 py-2 text-[11px] uppercase tracking-widest disabled:opacity-40"
        >
          Preview Label
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => openConfirm(printed ? "reprint" : "print")}
          className="btn-primary disabled:opacity-40"
        >
          {printed ? "Reprint Label" : "Print Label"}
        </button>
      </div>
      {printCount > 0 && (
        <p className="mt-2 text-xs text-ink-soft">Label printed {printCount} time(s) on this device.</p>
      )}
      {error && <p className="mt-2 text-sm text-red-800">{error}</p>}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="label-confirm-title"
            className="w-full max-w-md border border-line bg-paper p-5 shadow-lg"
          >
            <h3 id="label-confirm-title" className="text-lg font-medium">
              Confirm shipping label
            </h3>
            <p className="mt-2 text-sm text-ink-soft">
              Verify this is the correct package before generating the sticky label.
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Order</dt>
                <dd className="font-medium text-right">{verifySummary.orderId}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Customer</dt>
                <dd className="font-medium text-right">{verifySummary.customer}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">City / PIN</dt>
                <dd className="font-medium text-right">{verifySummary.cityPin}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Package</dt>
                <dd className="font-medium text-right">{verifySummary.packageId}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Tracking / AWB</dt>
                <dd className="font-medium text-right">{verifySummary.tracking}</dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
                className="border border-line px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={() => void runConfirmed()} className="btn-primary">
                {busy
                  ? "Generating…"
                  : pendingAction === "preview"
                    ? "Generate preview"
                    : printed
                      ? "Generate & reprint"
                      : "Generate & print"}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex h-[90vh] w-full max-w-3xl flex-col border border-line bg-paper shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-ink-soft">Label preview</p>
                <p className="font-medium">{order.id}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={previewUrl}
                  download={`shipping-label-${order.id}.pdf`}
                  className="border border-line px-3 py-2 text-[11px] uppercase tracking-widest"
                >
                  Download PDF
                </a>
                <button
                  type="button"
                  onClick={handlePrintFromPreview}
                  className="btn-primary"
                >
                  Print
                </button>
                <button type="button" onClick={closePreview} className="border border-line px-3 py-2 text-sm">
                  Close
                </button>
              </div>
            </div>
            <iframe title={`Shipping label ${order.id}`} src={previewUrl} className="min-h-0 flex-1 w-full bg-white" />
          </div>
        </div>
      )}
    </div>
  );
}
