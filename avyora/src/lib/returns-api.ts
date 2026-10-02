import { fetchJson } from "@/lib/api-client";

export type ReturnEventDto = {
  id: string;
  status: string;
  statusLabel: string;
  note: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  at: string;
};

export type ReturnDto = {
  id: string;
  returnNumber: string;
  orderId: string;
  orderItemId: string;
  customerId: string | null;
  customerEmail: string | null;
  customerName: string | null;
  quantity: number;
  reason: string;
  description: string | null;
  imageUrls: string[];
  status: string;
  statusLabel: string;
  requestedAt: string;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  pickupScheduledAt?: string | null;
  pickedUpAt?: string | null;
  inTransitAt?: string | null;
  warehouseReceivedAt: string | null;
  inspectionAt: string | null;
  refundEligibleAt: string | null;
  refundInitiatedAt?: string | null;
  refundCompletedAt?: string | null;
  cancelledAt?: string | null;
  productVerified: boolean;
  rejectReason: string | null;
  pickupNote: string | null;
  trackingNumber: string | null;
  courier: string | null;
  estimatedRefundAmount: number;
  updatedAt?: string;
  item: {
    id: string;
    productId: string;
    name: string;
    sku: string;
    image: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    deliveredAt: string | null;
  };
  order: {
    id: string;
    status: string;
    total: number;
    paymentMethod: string | null;
    deliveredAt: string | null;
    createdAt: string;
  };
  refund: {
    id: string;
    amount: number;
    method: string | null;
    status: string;
    providerRefundId: string | null;
    reason: string | null;
    initiatedAt: string | null;
    completedAt: string | null;
  } | null;
  events: ReturnEventDto[];
};

export type ReturnListDto = {
  returns: ReturnDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export function fetchAccountReturns() {
  return fetchJson<ReturnListDto>(`/api/account/returns?t=${Date.now()}`);
}

export function createAccountReturn(body: {
  orderId: string;
  orderItemId: string;
  reason: string;
  description?: string;
  quantity?: number;
  imageUrls?: string[];
}) {
  return fetchJson<ReturnDto>("/api/account/returns", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchAccountReturn(id: string) {
  return fetchJson<ReturnDto>(`/api/account/returns/${encodeURIComponent(id)}?t=${Date.now()}`);
}

export function cancelAccountReturn(id: string) {
  return fetchJson<ReturnDto>(`/api/account/returns/${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function fetchAdminReturns(params?: {
  status?: string;
  q?: string;
  orderId?: string;
  page?: number;
  from?: string;
  to?: string;
}) {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.q) search.set("q", params.q);
  if (params?.orderId) search.set("orderId", params.orderId);
  if (params?.page) search.set("page", String(params.page));
  if (params?.from) search.set("from", params.from);
  if (params?.to) search.set("to", params.to);
  search.set("t", String(Date.now()));
  return fetchJson<ReturnListDto>(`/api/admin/returns?${search.toString()}`);
}

export function fetchAdminReturn(id: string) {
  return fetchJson<ReturnDto>(
    `/api/admin/returns/${encodeURIComponent(id)}?t=${Date.now()}`,
  );
}

/** Next admin action label for list/detail badges. */
export function adminReturnNextStep(ret: Pick<ReturnDto, "status" | "warehouseReceivedAt" | "productVerified">): string | null {
  if (ret.status === "RETURN_REQUESTED") return "Approve or reject return";
  if (ret.status === "INSPECTION_APPROVED") return "Mark refund eligible";
  if (ret.status === "REFUND_ELIGIBLE") return "Generate refund";
  if (ret.status === "REFUND_INITIATED") return "Refund in progress";
  if (
    ret.warehouseReceivedAt ||
    ret.productVerified ||
    ret.status === "RECEIVED_AT_WAREHOUSE" ||
    ret.status === "INSPECTION_PENDING"
  ) {
    return "Product returned — waiting on logistics inspection";
  }
  if (
    ret.status === "RETURN_APPROVED" ||
    ret.status === "PICKUP_SCHEDULED" ||
    ret.status === "PICKED_UP" ||
    ret.status === "IN_TRANSIT"
  ) {
    return "Waiting on logistics pickup";
  }
  return null;
}

export function postAdminReturnAction(
  id: string,
  body: Record<string, unknown>,
) {
  return fetchJson<ReturnDto>(`/api/admin/returns/${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchLogisticsReturns(params?: {
  status?: string;
  q?: string;
  orderId?: string;
  page?: number;
}) {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.q) search.set("q", params.q);
  if (params?.orderId) search.set("orderId", params.orderId);
  if (params?.page) search.set("page", String(params.page));
  search.set("t", String(Date.now()));
  return fetchJson<ReturnListDto>(`/api/logistics/returns?${search.toString()}`);
}

export function fetchLogisticsReturn(id: string) {
  return fetchJson<ReturnDto>(`/api/logistics/returns/${encodeURIComponent(id)}`);
}

export function postLogisticsReturnAction(
  id: string,
  body: Record<string, unknown>,
) {
  return fetchJson<ReturnDto>(`/api/logistics/returns/${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
