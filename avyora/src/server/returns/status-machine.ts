import type { ReturnRequestStatus } from "@prisma/client";
import { RETURN_WINDOW_DAYS, isWithinReturnWindow, returnWindowDeadline } from "@/lib/return-window";

export { RETURN_WINDOW_DAYS, isWithinReturnWindow, returnWindowDeadline };

export const TERMINAL_RETURN_STATUSES: ReturnRequestStatus[] = [
  "RETURN_REJECTED",
  "RETURN_CANCELLED",
  "INSPECTION_REJECTED",
  "REFUND_COMPLETED",
];

export const ACTIVE_RETURN_STATUSES: ReturnRequestStatus[] = [
  "RETURN_REQUESTED",
  "RETURN_APPROVED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "IN_TRANSIT",
  "RECEIVED_AT_WAREHOUSE",
  "INSPECTION_PENDING",
  "INSPECTION_APPROVED",
  "REFUND_ELIGIBLE",
  "REFUND_INITIATED",
];

/** Customer-facing timeline steps (happy path). */
export const CUSTOMER_RETURN_TIMELINE: ReturnRequestStatus[] = [
  "RETURN_REQUESTED",
  "RETURN_APPROVED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "IN_TRANSIT",
  "RECEIVED_AT_WAREHOUSE",
  "INSPECTION_PENDING",
  "REFUND_ELIGIBLE",
  "REFUND_INITIATED",
  "REFUND_COMPLETED",
];

export type ReturnActorRole = "customer" | "admin" | "logistics" | "system";

type TransitionRule = {
  from: ReturnRequestStatus;
  to: ReturnRequestStatus;
  roles: ReturnActorRole[];
};

/**
 * Role split:
 * - Admin: approve/reject return, mark refund eligible, initiate/complete refund
 * - Logistics: pickup → transit → warehouse → inspection
 * - Customer: create request + cancel early
 * Warehouse receipt auto-advances to INSPECTION_PENDING (system) in the service layer.
 */
const TRANSITIONS: TransitionRule[] = [
  // Admin decisions
  { from: "RETURN_REQUESTED", to: "RETURN_APPROVED", roles: ["admin"] },
  { from: "RETURN_REQUESTED", to: "RETURN_REJECTED", roles: ["admin"] },
  { from: "RETURN_REQUESTED", to: "RETURN_CANCELLED", roles: ["customer", "admin"] },
  { from: "RETURN_APPROVED", to: "RETURN_CANCELLED", roles: ["customer", "admin"] },
  { from: "PICKUP_SCHEDULED", to: "RETURN_CANCELLED", roles: ["admin"] },
  { from: "INSPECTION_APPROVED", to: "REFUND_ELIGIBLE", roles: ["admin"] },
  { from: "REFUND_ELIGIBLE", to: "REFUND_INITIATED", roles: ["admin"] },
  { from: "REFUND_INITIATED", to: "REFUND_COMPLETED", roles: ["admin", "system"] },
  // Logistics decisions
  { from: "RETURN_APPROVED", to: "PICKUP_SCHEDULED", roles: ["logistics"] },
  { from: "PICKUP_SCHEDULED", to: "PICKED_UP", roles: ["logistics"] },
  { from: "PICKED_UP", to: "IN_TRANSIT", roles: ["logistics"] },
  { from: "IN_TRANSIT", to: "RECEIVED_AT_WAREHOUSE", roles: ["logistics"] },
  { from: "RECEIVED_AT_WAREHOUSE", to: "INSPECTION_PENDING", roles: ["logistics", "system"] },
  { from: "INSPECTION_PENDING", to: "INSPECTION_APPROVED", roles: ["logistics"] },
  { from: "INSPECTION_PENDING", to: "INSPECTION_REJECTED", roles: ["logistics"] },
];

export function canTransitionReturnStatus(
  from: ReturnRequestStatus,
  to: ReturnRequestStatus,
  role: ReturnActorRole,
): { ok: true } | { ok: false; message: string } {
  if (from === to) {
    return { ok: false, message: "Return is already in that status." };
  }
  if (TERMINAL_RETURN_STATUSES.includes(from)) {
    return { ok: false, message: `Cannot change a return after ${from}.` };
  }
  const rule = TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!rule) {
    return { ok: false, message: `Invalid transition from ${from} to ${to}.` };
  }
  if (!rule.roles.includes(role) && role !== "system") {
    return { ok: false, message: `Role "${role}" cannot move return from ${from} to ${to}.` };
  }
  return { ok: true };
}

export function labelReturnStatus(status: ReturnRequestStatus): string {
  switch (status) {
    case "RETURN_REQUESTED":
      return "Return requested";
    case "RETURN_APPROVED":
      return "Return approved";
    case "PICKUP_SCHEDULED":
      return "Pickup scheduled";
    case "PICKED_UP":
      return "Picked up";
    case "IN_TRANSIT":
      return "In transit";
    case "RECEIVED_AT_WAREHOUSE":
      return "Received at warehouse";
    case "INSPECTION_PENDING":
      return "Inspection pending";
    case "INSPECTION_APPROVED":
      return "Inspection confirmed";
    case "REFUND_ELIGIBLE":
      return "Refund eligible";
    case "REFUND_INITIATED":
      return "Refund initiated";
    case "REFUND_COMPLETED":
      return "Refund completed";
    case "RETURN_REJECTED":
      return "Return rejected";
    case "RETURN_CANCELLED":
      return "Return cancelled";
    case "INSPECTION_REJECTED":
      return "Inspection rejected";
    default:
      return status;
  }
}

/** Conditions required before admin may initiate a refund. */
export function refundPreconditionsMet(input: {
  status: ReturnRequestStatus;
  warehouseReceivedAt: Date | null;
  productVerified: boolean;
  inspectionAt: Date | null;
}): { ok: true } | { ok: false; message: string } {
  if (input.status !== "REFUND_ELIGIBLE") {
    return { ok: false, message: "Refund requires status REFUND_ELIGIBLE." };
  }
  if (!input.warehouseReceivedAt) {
    return { ok: false, message: "Warehouse receipt is required before refund." };
  }
  if (!input.productVerified) {
    return { ok: false, message: "Product/order-item verification is required before refund." };
  }
  if (!input.inspectionAt) {
    return { ok: false, message: "Inspection approval is required before refund." };
  }
  return { ok: true };
}
