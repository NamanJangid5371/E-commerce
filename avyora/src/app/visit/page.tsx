"use client";

import {
  availableSlots,
  earliestBookableDate,
  formatVisitWhen,
  isMaisonOpen,
  purposeLabel,
  takenTimes,
  TIME_SLOTS,
  VIEWING_PURPOSES,
} from "@/lib/appointments";
import { site } from "@/data/content";
import { useLiveCatalog, useShopStore } from "@/store/shop-store";
import type { AppointmentPurpose } from "@/store/shop-types";
import { Calendar, MapPin } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";

function VisitInner() {
  const search = useSearchParams();
  const pieceSlug = search.get("piece") ?? "";
  const { products, ops } = useLiveCatalog();
  const appointments = useShopStore((s) => s.appointments);
  const bookAppointment = useShopStore((s) => s.bookAppointment);
  const user = useShopStore((s) => s.user);
  const customers = useShopStore((s) => s.customers);
  const piece = products.find((p) => p.slug === pieceSlug);
  const customer = customers.find((c) => c.email.toLowerCase() === user?.email.toLowerCase());
  const settings = ops?.settings;
  const minDate = earliestBookableDate();

  const [name, setName] = useState(user?.role === "customer" ? user.name : "");
  const [email, setEmail] = useState(user?.role === "customer" ? user.email : "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [date, setDate] = useState(minDate);
  const [time, setTime] = useState("");
  const [purpose, setPurpose] = useState<AppointmentPurpose>(piece ? "try-on" : "bridal");
  const [guests, setGuests] = useState(1);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [bookedId, setBookedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ date: string; time: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/appointments", { credentials: "include" })
      .then((res) => res.json())
      .then((data: { busy?: { date: string; time: string }[]; appointments?: typeof appointments }) => {
        if (cancelled) return;
        if (Array.isArray(data.busy)) setBusy(data.busy);
        if (Array.isArray(data.appointments) && data.appointments.length) {
          useShopStore.setState((state) => {
            const byId = new Map(state.appointments.map((a) => [a.id, a]));
            for (const a of data.appointments!) byId.set(a.id, a);
            return { appointments: [...byId.values()] };
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const taken = useMemo(() => {
    const fromStore = takenTimes(appointments, date);
    const fromServer = busy.filter((b) => b.date === date).map((b) => b.time);
    return [...new Set([...fromStore, ...fromServer])];
  }, [appointments, busy, date]);
  const openSlots = useMemo(() => availableSlots(date, taken), [date, taken]);
  const booked = appointments.find((a) => a.id === bookedId);

  function onDateChange(value: string) {
    setDate(value);
    setTime("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!isMaisonOpen(date)) {
      setError("The maison is closed on Mondays. Choose Tuesday to Sunday.");
      return;
    }
    if (!time) {
      setError("Please choose a visiting hour.");
      return;
    }
    setSaving(true);
    const result = await bookAppointment({
      name,
      email,
      phone,
      date,
      time,
      purpose,
      guests,
      notes,
      productSlug: piece?.slug,
    });
    setSaving(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setBusy((prev) => [...prev, { date: result.appointment.date, time: result.appointment.time }]);
    setBookedId(result.appointment.id);
  }

  if (booked) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <p className="section-kicker">Walton Road</p>
        <h1 className="section-title mt-2">Your visit is requested</h1>
        <p className="mt-4 text-sm leading-7 text-ink-soft">
          {booked.name}, we have {formatVisitWhen(booked.date, booked.time)} for {purposeLabel(booked.purpose).toLowerCase()}.
          The salon will confirm by email or phone.
        </p>
        <p className="mt-4 text-sm text-ink-soft">
          {settings?.address ?? site.address}
          <br />
          {settings?.hours ?? "Tue–Sun, 11:00–19:00"}
        </p>
        {piece && (
          <p className="mt-3 text-sm">
            We’ll have <Link href={`/product/${piece.slug}`} className="underline">{piece.name}</Link> ready to try.
          </p>
        )}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/shop" className="btn-primary">
            Continue shopping
          </Link>
          {user?.role === "customer" && (
            <Link href="/account?section=visits" className="btn-secondary">
              View my visits
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <section className="border-b border-line bg-ivory">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:grid-cols-2 md:py-16">
          <div>
            <p className="section-kicker">Bengaluru maison</p>
            <h1 className="section-title mt-2">Book a viewing</h1>
            <p className="mt-4 max-w-md text-sm leading-7 text-ink-soft">
              Avyora is not only a catalogue. Come to 12 Walton Road by appointment — try a piece on, talk through a bridal
              set, or bring a ring in for resizing. Visits are private and last about an hour.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-ink-soft">
              <li className="flex gap-2">
                <MapPin size={16} className="mt-0.5 shrink-0 text-gold-deep" />
                {settings?.address ?? site.address}
              </li>
              <li className="flex gap-2">
                <Calendar size={16} className="mt-0.5 shrink-0 text-gold-deep" />
                {settings?.hours ?? "Tue–Sun, 11:00–19:00"} · Closed Mondays
              </li>
            </ul>
            {piece && (
              <p className="mt-6 border border-line bg-paper px-4 py-3 text-sm">
                Requesting a viewing of{" "}
                <Link href={`/product/${piece.slug}`} className="font-medium underline">
                  {piece.name}
                </Link>
                .
              </p>
            )}
          </div>

          <form onSubmit={onSubmit} className="shadow-soft border border-line bg-paper p-5 md:p-8">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm sm:col-span-2">
                Full name
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full border border-line bg-transparent px-3 py-2.5"
                />
              </label>
              <label className="block text-sm">
                Email
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full border border-line bg-transparent px-3 py-2.5"
                />
              </label>
              <label className="block text-sm">
                Phone
                <input
                  required
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 w-full border border-line bg-transparent px-3 py-2.5"
                />
              </label>
              <label className="block text-sm">
                Date
                <input
                  required
                  type="date"
                  min={minDate}
                  value={date}
                  onChange={(e) => onDateChange(e.target.value)}
                  className="mt-1 w-full border border-line bg-transparent px-3 py-2.5"
                />
              </label>
              <label className="block text-sm">
                Guests
                <select
                  value={guests}
                  onChange={(e) => setGuests(Number(e.target.value))}
                  className="mt-1 w-full border border-line bg-transparent px-3 py-2.5"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="mt-5 text-[11px] tracking-[0.16em] uppercase text-ink-soft">Hour</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TIME_SLOTS.map((slot) => {
                const open = openSlots.includes(slot);
                return (
                  <button
                    key={slot}
                    type="button"
                    disabled={!open}
                    onClick={() => setTime(slot)}
                    className={`min-w-16 border px-3 py-2 text-sm transition ${
                      time === slot
                        ? "border-ink bg-ink text-ivory"
                        : open
                          ? "border-line hover:border-ink"
                          : "cursor-not-allowed border-line text-ink-soft/40"
                    }`}
                  >
                    {slot}
                  </button>
                );
              })}
            </div>
            {!isMaisonOpen(date) && (
              <p className="mt-2 text-xs text-ink-soft">Closed on Mondays.</p>
            )}

            <p className="mt-5 text-[11px] tracking-[0.16em] uppercase text-ink-soft">Why you’re visiting</p>
            <div className="mt-2 grid gap-2">
              {VIEWING_PURPOSES.map((p) => (
                <label
                  key={p.id}
                  className={`flex cursor-pointer items-start gap-3 border px-3 py-2.5 text-sm ${
                    purpose === p.id ? "border-ink" : "border-line"
                  }`}
                >
                  <input
                    type="radio"
                    name="purpose"
                    checked={purpose === p.id}
                    onChange={() => setPurpose(p.id)}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">{p.label}</span>
                    <span className="mt-0.5 block text-xs text-ink-soft">{p.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <label className="mt-5 block text-sm">
              Notes for the salon (optional)
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="mt-1 w-full border border-line bg-transparent px-3 py-2.5"
                placeholder="Ring size, budget, or anything we should prepare."
              />
            </label>

            {error && <p className="mt-4 text-sm text-red-800">{error}</p>}
            <button type="submit" disabled={saving} className="btn-primary mt-6 w-full py-3.5 disabled:opacity-60">
              {saving ? "Saving…" : "Request this hour"}
            </button>
            <p className="mt-3 text-xs text-ink-soft">
              A request holds the hour until the atelier confirms. You can cancel from your account if you sign in with the
              same email.
            </p>
          </form>
        </div>
      </section>
    </div>
  );
}

export default function VisitPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-xl px-4 py-20 text-sm text-ink-soft">Loading the salon diary…</div>}>
      <VisitInner />
    </Suspense>
  );
}
