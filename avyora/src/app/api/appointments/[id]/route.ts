import { isActiveAppointment, isMaisonOpen } from "@/lib/appointments";
import { CommerceMutationAbort, mutateCommerce } from "@/server/commerce-db";
import { hasAnyPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest } from "@/server/auth/rbac";
import type { Appointment, AppointmentStatus } from "@/store/shop-types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const STATUSES: AppointmentStatus[] = ["requested", "confirmed", "completed", "cancelled", "no-show"];

function audit(actor: string, action: string, detail: string) {
  return {
    id: `aud-${Date.now().toString(36)}`,
    at: new Date().toISOString(),
    actor,
    action,
    detail,
  };
}

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const session = await getSessionFromRequest(request);
    const body = (await request.json()) as Partial<Appointment>;

    const email = session?.email?.trim().toLowerCase();
    const isStaff = Boolean(
      session &&
        hasAnyPermission(session.permissions, [
          PERMISSIONS.ORDER_VIEW,
          PERMISSIONS.ORDER_UPDATE,
          PERMISSIONS.CUSTOMER_VIEW,
          PERMISSIONS.SETTINGS_MANAGE,
        ]),
    );

    let nextAppt: Appointment | undefined;
    try {
      await mutateCommerce((current) => {
        const existing = (current.appointments ?? []).find((a) => a.id === id);
        if (!existing) {
          throw new CommerceMutationAbort("Visit not found.", 404);
        }

        const isOwner = Boolean(email && existing.email.toLowerCase() === email);
        if (!isOwner && !isStaff) {
          throw new CommerceMutationAbort("Authentication required.", 401);
        }

        if (!isStaff) {
          if (body.status && body.status !== "cancelled") {
            throw new CommerceMutationAbort("You can only cancel this visit.", 403);
          }
          if (!isActiveAppointment(existing.status)) {
            throw new CommerceMutationAbort("This visit can no longer be cancelled.", 400);
          }
        }

        const updated: Appointment = {
          ...existing,
          ...(isStaff
            ? {
                date: body.date ?? existing.date,
                time: body.time ?? existing.time,
                status: body.status && STATUSES.includes(body.status) ? body.status : existing.status,
                staffNote: body.staffNote ?? existing.staffNote,
                purpose: body.purpose ?? existing.purpose,
                guests: body.guests ?? existing.guests,
                notes: body.notes ?? existing.notes,
              }
            : { status: "cancelled" }),
        };

        if (isStaff && (body.date || body.time)) {
          if (!isMaisonOpen(updated.date)) {
            throw new CommerceMutationAbort("The maison is closed on Mondays.", 400);
          }
          const clash = (current.appointments ?? []).some(
            (a) =>
              a.id !== id &&
              a.date === updated.date &&
              a.time === updated.time &&
              isActiveAppointment(a.status),
          );
          if (clash) {
            throw new CommerceMutationAbort("That hour is already reserved.", 409);
          }
        }

        const actor = email ?? "staff";
        const action =
          updated.status === "cancelled" && existing.status !== "cancelled"
            ? "appointment.cancelled"
            : "appointment.updated";
        nextAppt = updated;
        return {
          ...current,
          appointments: (current.appointments ?? []).map((a) => (a.id === id ? updated : a)),
          audit: [
            audit(actor, action, `${existing.name} · ${updated.status}`),
            ...(current.audit ?? []),
          ].slice(0, 200),
        };
      });
    } catch (error) {
      if (error instanceof CommerceMutationAbort) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    return NextResponse.json({ appointment: nextAppt });
  } catch (error) {
    console.error("[appointments/id]", error);
    return NextResponse.json({ error: "Could not update appointment." }, { status: 500 });
  }
}
