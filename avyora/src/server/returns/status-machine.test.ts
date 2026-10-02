import { describe, expect, it } from "vitest";
import {
  canTransitionReturnStatus,
  isWithinReturnWindow,
  refundPreconditionsMet,
  RETURN_WINDOW_DAYS,
} from "@/server/returns/status-machine";

describe("return status machine", () => {
  it("allows only valid role-gated transitions", () => {
    expect(canTransitionReturnStatus("RETURN_REQUESTED", "RETURN_APPROVED", "admin").ok).toBe(true);
    expect(canTransitionReturnStatus("RETURN_REQUESTED", "RETURN_APPROVED", "customer").ok).toBe(false);
    expect(canTransitionReturnStatus("RETURN_REQUESTED", "RETURN_APPROVED", "logistics").ok).toBe(false);
    expect(canTransitionReturnStatus("RETURN_APPROVED", "PICKUP_SCHEDULED", "logistics").ok).toBe(true);
    expect(canTransitionReturnStatus("RETURN_APPROVED", "PICKUP_SCHEDULED", "admin").ok).toBe(false);
    expect(canTransitionReturnStatus("INSPECTION_PENDING", "INSPECTION_APPROVED", "logistics").ok).toBe(
      true,
    );
    expect(canTransitionReturnStatus("INSPECTION_PENDING", "INSPECTION_APPROVED", "admin").ok).toBe(
      false,
    );
    expect(canTransitionReturnStatus("INSPECTION_APPROVED", "REFUND_ELIGIBLE", "admin").ok).toBe(true);
    expect(canTransitionReturnStatus("INSPECTION_APPROVED", "REFUND_ELIGIBLE", "logistics").ok).toBe(
      false,
    );
    expect(canTransitionReturnStatus("PICKED_UP", "REFUND_COMPLETED", "admin").ok).toBe(false);
    expect(canTransitionReturnStatus("REFUND_ELIGIBLE", "REFUND_INITIATED", "logistics").ok).toBe(false);
    expect(canTransitionReturnStatus("REFUND_ELIGIBLE", "REFUND_INITIATED", "admin").ok).toBe(true);
  });

  it("blocks jumps and terminal changes", () => {
    expect(canTransitionReturnStatus("RETURN_REQUESTED", "PICKED_UP", "logistics").ok).toBe(false);
    expect(canTransitionReturnStatus("REFUND_COMPLETED", "RETURN_APPROVED", "admin").ok).toBe(false);
    expect(canTransitionReturnStatus("RETURN_REJECTED", "RETURN_APPROVED", "admin").ok).toBe(false);
  });

  it("enforces 15-day window from delivery timestamp", () => {
    const delivered = new Date("2026-09-01T10:00:00.000Z");
    expect(isWithinReturnWindow(delivered, new Date("2026-09-10T10:00:00.000Z"))).toBe(true);
    expect(
      isWithinReturnWindow(
        delivered,
        new Date(delivered.getTime() + RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000 + 1),
      ),
    ).toBe(false);
    expect(isWithinReturnWindow(null)).toBe(false);
  });

  it("requires warehouse + verification + inspection before refund", () => {
    expect(
      refundPreconditionsMet({
        status: "REFUND_ELIGIBLE",
        warehouseReceivedAt: new Date(),
        productVerified: true,
        inspectionAt: new Date(),
      }).ok,
    ).toBe(true);

    expect(
      refundPreconditionsMet({
        status: "INSPECTION_PENDING",
        warehouseReceivedAt: new Date(),
        productVerified: true,
        inspectionAt: new Date(),
      }).ok,
    ).toBe(false);

    expect(
      refundPreconditionsMet({
        status: "REFUND_ELIGIBLE",
        warehouseReceivedAt: null,
        productVerified: true,
        inspectionAt: new Date(),
      }).ok,
    ).toBe(false);

    expect(
      refundPreconditionsMet({
        status: "REFUND_ELIGIBLE",
        warehouseReceivedAt: new Date(),
        productVerified: false,
        inspectionAt: new Date(),
      }).ok,
    ).toBe(false);
  });
});
