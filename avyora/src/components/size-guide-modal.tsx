"use client";

import { RING_SIZE_GUIDE } from "@/lib/size-guide";
import { useEffect } from "react";

export function SizeGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center" onClick={onClose}>
      <div
        className="shadow-soft max-h-[85vh] w-full max-w-lg overflow-auto border border-line bg-paper p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Ring size guide"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Atelier fit</p>
            <h2 className="mt-1 font-serif text-3xl tracking-tight">Ring size guide</h2>
          </div>
          <button type="button" onClick={onClose} className="text-sm underline">
            Close
          </button>
        </div>
        <p className="mt-3 text-sm text-ink-soft">
          Measure the inner diameter of a well-fitting ring (mm), or the circumference of your finger.
          Most Avyora rings can be resized once within 30 days.
        </p>
        <table className="mt-6 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] tracking-widest uppercase text-ink-soft">
              <th className="py-2 font-medium">India</th>
              <th className="py-2 font-medium">Diameter</th>
              <th className="py-2 font-medium">Circumference</th>
            </tr>
          </thead>
          <tbody>
            {RING_SIZE_GUIDE.map((row) => (
              <tr key={row.india} className="border-b border-line/70">
                <td className="py-2">{row.india}</td>
                <td className="py-2">{row.diameter} mm</td>
                <td className="py-2">{row.circumference} mm</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
