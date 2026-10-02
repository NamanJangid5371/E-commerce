/** Client-safe return status labels (mirrors ReturnRequestStatus). */

export const CUSTOMER_RETURN_TIMELINE = [
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
] as const;

export type CustomerReturnTimelineStatus = (typeof CUSTOMER_RETURN_TIMELINE)[number];

export function labelReturnStatus(status: string): string {
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
