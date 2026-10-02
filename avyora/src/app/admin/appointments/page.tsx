"use client";

import {
  APPOINTMENT_STATUS,
  formatVisitWhen,
  purposeLabel,
  statusLabel,
} from "@/lib/appointments";
import { useLiveCatalog, useShopStore } from "@/store/shop-store";
import type { AppointmentStatus } from "@/store/shop-types";
import { STOREFRONT_ORIGIN } from "@/lib/host";
import { useMemo, useState } from "react";

const FILTERS = ["upcoming", "requested", "all"] as const;

export default function AdminAppointments() {
  const appointments = useShopStore((s) => s.appointments);
  const updateAppointment = useShopStore((s) => s.updateAppointment);
  const { products } = useLiveCatalog();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("upcoming");
  const [noteId, setNoteId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const list = useMemo(() => {
    const sorted = [...appointments].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
    if (filter === "requested") return sorted.filter((a) => a.status === "requested");
    if (filter === "upcoming") {
      return sorted.filter((a) => (a.status === "requested" || a.status === "confirmed") && a.date >= today);
    }
    return sorted;
  }, [appointments, filter, today]);

  function setStatus(id: string, status: AppointmentStatus) {
    void updateAppointment(id, { status }).then((err) => {
      if (err) alert(err);
    });
  }

  function saveNote(id: string) {
    void updateAppointment(id, { staffNote: note.trim() || undefined });
    setNoteId(null);
    setNote("");
  }

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Atelier visits</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Walton Road viewings booked from the storefront. Confirm the hour, add a salon note, then mark complete.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`border px-4 py-2 text-xs uppercase tracking-widest ${
              filter === id ? "border-ink bg-ink text-ivory" : "border-line"
            }`}
          >
            {id}
          </button>
        ))}
      </div>
      <div className="mt-8 space-y-4">
        {list.map((a) => {
          const product = a.productSlug ? products.find((p) => p.slug === a.productSlug) : undefined;
          return (
            <article key={a.id} className="border border-line bg-paper p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{a.name}</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {formatVisitWhen(a.date, a.time)} · {purposeLabel(a.purpose)} · {a.guests} guest{a.guests === 1 ? "" : "s"}
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {a.email} · {a.phone}
                  </p>
                  {product && (
                    <p className="mt-1 text-sm">
                      Piece:{" "}
                      <a href={`${STOREFRONT_ORIGIN}/product/${product.slug}`} className="underline" target="_blank" rel="noreferrer">
                        {product.name}
                      </a>
                    </p>
                  )}
                  {a.notes && <p className="mt-2 text-sm">{a.notes}</p>}
                  {a.staffNote && <p className="mt-1 text-sm text-ink-soft">Salon: {a.staffNote}</p>}
                </div>
                <span className="border border-line px-2 py-1 text-[11px] uppercase tracking-widest">{statusLabel(a.status)}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-3 text-xs uppercase tracking-widest">
                {a.status === "requested" && (
                  <button type="button" onClick={() => setStatus(a.id, "confirmed")}>
                    Confirm
                  </button>
                )}
                {(a.status === "requested" || a.status === "confirmed") && (
                  <>
                    <button type="button" onClick={() => setStatus(a.id, "completed")}>
                      Complete
                    </button>
                    <button type="button" onClick={() => setStatus(a.id, "no-show")}>
                      No-show
                    </button>
                    <button type="button" onClick={() => setStatus(a.id, "cancelled")}>
                      Cancel
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setNoteId(a.id);
                    setNote(a.staffNote ?? "");
                  }}
                >
                  Salon note
                </button>
                {a.status !== "requested" && a.status !== "confirmed" && (
                  <select
                    value={a.status}
                    onChange={(e) => setStatus(a.id, e.target.value as AppointmentStatus)}
                    className="border border-line bg-transparent px-2 py-1"
                  >
                    {APPOINTMENT_STATUS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {noteId === a.id && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Table, size, follow-up…"
                    className="min-w-64 flex-1 border border-line bg-transparent px-3 py-2 text-sm"
                  />
                  <button type="button" onClick={() => saveNote(a.id)} className="border border-ink px-3 py-2 text-xs uppercase tracking-widest">
                    Save
                  </button>
                </div>
              )}
            </article>
          );
        })}
        {!list.length && <p className="text-sm text-ink-soft">No visits in this view.</p>}
      </div>
    </div>
  );
}
