import { isActiveAppointment, isMaisonOpen, isPastSlot, TIME_SLOTS } from "@/lib/appointments";
import { CommerceMutationAbort, loadCommerce, mutateCommerce } from "@/server/commerce-db";
import { hasAnyPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { clientIpFromRequest, rateLimit } from "@/server/security/rate-limit";
import type { Appointment, AppointmentPurpose, AppointmentStatus } from "@/store/shop-types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PURPOSES: AppointmentPurpose[] = ["bridal", "try-on", "everyday", "resize", "care"];

function canManageAppointments(permissions: string[]) {
  return hasAnyPermission(permissions, [
    PERMISSIONS.ORDER_VIEW,
    PERMISSIONS.ORDER_UPDATE,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.SETTINGS_MANAGE,
  ]);
}

function busySlots(appointments: Appointment[]) {
  return appointments
    .filter((a) => isActiveAppointment(a.status))
    .map((a) => ({ date: a.date, time: a.time }));
}

function audit(actor: string, action: string, detail: string) {
  return {
    id: `aud-${Date.now().toString(36)}`,
    at: new Date().toISOString(),
    actor,
    action,
    detail,
  };
}

function jsonErr(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

/** List appointments (own / staff) and public busy slots. */
export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  const snapshot = loadCommerce();
  const appointments = snapshot.appointments ?? [];
  const busy = busySlots(appointments);

  if (session && canManageAppointments(session.permissions)) {
    return NextResponse.json({ ok: true, appointments, busy });
  }

  if (session?.email) {
    const email = session.email.trim().toLowerCase();
    return NextResponse.json({
      ok: true,
      appointments: appointments.filter((a) => a.email.toLowerCase() === email),
      busy,
    });
  }

  // Anonymous: busy slots only — never leak full appointment PII.
  return NextResponse.json({ ok: true, appointments: [], busy });
}

/** Persist a new atelier visit into durable commerce.json (and survive server restarts). */
export async function POST(request: Request) {
  try {
    const ip = clientIpFromRequest(request);
    const limited = rateLimit(`appointments:${ip}`, 8, 15 * 60_000);
    if (!limited.ok) {
      return jsonErr(
        "Too many booking attempts. Please wait and try again.",
        429,
        "RATE_LIMITED",
      );
    }

    const body = (await request.json()) as {
      name?: string;
      email?: string;
      phone?: string;
      date?: string;
      time?: string;
      purpose?: AppointmentPurpose;
      guests?: number;
      notes?: string;
      productSlug?: string;
    };

    const name = body.name?.trim() ?? "";
    const email = body.email?.trim().toLowerCase() ?? "";
    const phone = body.phone?.trim() ?? "";
    const notes = body.notes?.trim().slice(0, 500);
    const date = body.date?.trim() ?? "";
    const time = body.time?.trim() ?? "";
    const purpose = body.purpose;

    if (!name || name.length > 120 || !email || email.length > 200 || !phone || phone.length > 40) {
      return jsonErr("Please share a valid name, email and phone.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonErr("Please enter a valid email.");
    }
    if (!/^[\d+\-\s()]{7,20}$/.test(phone)) {
      return jsonErr("Please enter a valid phone number.");
    }
    if (!date || !isMaisonOpen(date)) {
      return jsonErr("The maison is closed on Mondays. Choose Tuesday to Sunday.");
    }
    if (!(TIME_SLOTS as readonly string[]).includes(time)) {
      return jsonErr("Choose a visiting hour between 11:00 and 18:00.");
    }
    if (isPastSlot(date, time)) {
      return jsonErr("That hour has already passed. Please pick another.");
    }
    if (!purpose || !PURPOSES.includes(purpose)) {
      return jsonErr("Choose a visit purpose.");
    }

    const guests = Math.min(4, Math.max(1, Math.round(Number(body.guests) || 1)));
    const productSlug = body.productSlug?.trim().slice(0, 120) || undefined;

    let appointment: Appointment;
    try {
      await mutateCommerce((current) => {
        const duplicate = (current.appointments ?? []).some(
          (a) =>
            a.email.toLowerCase() === email &&
            a.date === date &&
            a.time === time &&
            isActiveAppointment(a.status),
        );
        if (duplicate) {
          throw new CommerceMutationAbort(
            "You already have a request for this hour.",
            409,
            "DUPLICATE",
          );
        }

        const busy = (current.appointments ?? []).some(
          (a) => a.date === date && a.time === time && isActiveAppointment(a.status),
        );
        if (busy) {
          throw new CommerceMutationAbort(
            "That hour is already reserved. Please choose another.",
            409,
            "SLOT_TAKEN",
          );
        }

        appointment = {
          id: `apt-${Date.now().toString(36)}`,
          createdAt: new Date().toISOString(),
          name,
          email,
          phone,
          date,
          time,
          purpose,
          guests,
          notes: notes || undefined,
          productSlug,
          status: "requested" as AppointmentStatus,
        };

        return {
          ...current,
          appointments: [appointment, ...(current.appointments ?? [])],
          audit: [
            audit(email, "appointment.booked", `${name} · ${date} ${time}`),
            ...(current.audit ?? []),
          ].slice(0, 200),
        };
      });
    } catch (error) {
      if (error instanceof CommerceMutationAbort) {
        return jsonErr(error.message, error.status, error.code ?? "BAD_REQUEST");
      }
      throw error;
    }

    return NextResponse.json({ ok: true, appointment: appointment! }, { status: 201 });
  } catch (error) {
    console.error("[appointments]", error);
    return jsonErr("Could not save appointment.", 500, "INTERNAL");
  }
}
