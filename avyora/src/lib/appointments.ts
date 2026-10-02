import { localISODate } from "@/lib/format";
import type { Appointment, AppointmentPurpose, AppointmentStatus } from "@/store/shop-types";

export const VIEWING_PURPOSES: { id: AppointmentPurpose; label: string; hint: string }[] = [
  { id: "bridal", label: "Bridal consultation", hint: "Solitaires, sets and resizing plans" },
  { id: "try-on", label: "Try on a listed piece", hint: "We’ll have it ready in the salon" },
  { id: "everyday", label: "Everyday jewellery", hint: "Gold, pearls and daily wear" },
  { id: "resize", label: "Resizing", hint: "Bring the ring if you already own it" },
  { id: "care", label: "Cleaning & care", hint: "Complimentary polish with a visit" },
];

export const TIME_SLOTS = ["11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"] as const;

export const APPOINTMENT_STATUS: { id: AppointmentStatus; label: string }[] = [
  { id: "requested", label: "Requested" },
  { id: "confirmed", label: "Confirmed" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "no-show", label: "No-show" },
];

export function purposeLabel(id: AppointmentPurpose) {
  return VIEWING_PURPOSES.find((p) => p.id === id)?.label ?? id;
}

export function statusLabel(id: AppointmentStatus) {
  return APPOINTMENT_STATUS.find((s) => s.id === id)?.label ?? id;
}

export function parseISODate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function isMaisonOpen(date: string) {
  return parseISODate(date).getDay() !== 1;
}

export function isActiveAppointment(status: AppointmentStatus) {
  return status === "requested" || status === "confirmed";
}

export function isPastSlot(date: string, time: string, now = new Date()) {
  const [hh, mm] = time.split(":").map(Number);
  const when = parseISODate(date);
  when.setHours(hh ?? 0, mm ?? 0, 0, 0);
  return when.getTime() <= now.getTime();
}

export function earliestBookableDate(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (now.getHours() >= 18) d.setDate(d.getDate() + 1);
  while (d.getDay() === 1) d.setDate(d.getDate() + 1);
  return localISODate(d);
}

export function nextOpenDate(from: Date, offsetDays: number) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offsetDays);
  while (d.getDay() === 1) d.setDate(d.getDate() + 1);
  return localISODate(d);
}

export function availableSlots(date: string, taken: string[], now = new Date()) {
  return TIME_SLOTS.filter((time) => !taken.includes(time) && !isPastSlot(date, time, now));
}

export function takenTimes(appointments: Appointment[], date: string, exceptId?: string) {
  return appointments
    .filter((a) => a.date === date && isActiveAppointment(a.status) && a.id !== exceptId)
    .map((a) => a.time);
}

export function formatVisitWhen(date: string, time: string) {
  const label = parseISODate(date).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return `${label} · ${time}`;
}

export function seedAppointments(_now = new Date()): Appointment[] {
  // New business: no demo salon bookings.
  return [];
}
