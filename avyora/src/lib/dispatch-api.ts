import { fetchJson } from "@/lib/api-client";
import type { DeliveryAttemptReason, Order, OrderStatus } from "@/store/shop-types";

export type DispatchScope = {
  partnerName: string | null;
  partner: { id: string; name: string; email?: string; phone?: string } | null;
  isOpsOverseer: boolean;
};

export type DispatchListResult = {
  orders: Order[];
  total: number;
  scope: DispatchScope;
};

export function fetchDispatchOrders(params?: { q?: string; page?: number; pageSize?: number }) {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.page) search.set("page", String(params.page));
  if (params?.pageSize) search.set("pageSize", String(params.pageSize ?? 50));
  const qs = search.toString();
  return fetchJson<DispatchListResult>(`/api/dispatch/orders${qs ? `?${qs}` : ""}`);
}

export function fetchDispatchOrder(id: string) {
  return fetchJson<{ order: Order; scope: DispatchScope }>(
    `/api/dispatch/orders/${encodeURIComponent(id)}`,
  );
}

export function patchDispatchOrder(
  id: string,
  body: {
    status?: OrderStatus;
    location?: string;
    note?: string;
  },
) {
  return fetchJson<{ order: Order }>(`/api/dispatch/orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function postDispatchAttempt(
  id: string,
  body: {
    status: "attempted" | "failed" | "rescheduled" | "delivered";
    reason?: DeliveryAttemptReason;
    note?: string;
    location?: string;
    setFailedDelivery?: boolean;
  },
) {
  return fetchJson<{ order: Order }>(`/api/dispatch/orders/${encodeURIComponent(id)}/attempts`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function postDispatchCodAction(id: string, body: Record<string, unknown>) {
  return fetchJson<{
    cod?: Order["codDelivery"];
    order?: Order;
    alreadyVerified?: boolean;
    alreadyCollected?: boolean;
    autoDelivered?: boolean;
    devCode?: string;
    razorpayOrderId?: string;
    amount?: number;
    currency?: string;
    keyId?: string;
    orderNumber?: string;
  }>(`/api/dispatch/orders/${encodeURIComponent(id)}/cod`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
