import { fetchJson } from "@/lib/api-client";
import type { DeliveryAttemptReason, Order, OrderStatus } from "@/store/shop-types";

export type LogisticsListResult = {
  orders: Order[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  updatedAt?: string;
};

export async function fetchLogisticsOrders(params?: {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.status) search.set("status", params.status);
  if (params?.page) search.set("page", String(params.page));
  if (params?.pageSize) search.set("pageSize", String(params.pageSize ?? 100));
  const qs = search.toString();
  return fetchJson<LogisticsListResult>(`/api/logistics/orders${qs ? `?${qs}` : "?pageSize=100"}`);
}

export async function fetchLogisticsOrder(id: string) {
  return fetchJson<Order>(`/api/logistics/orders/${encodeURIComponent(id)}`);
}

export async function patchLogisticsOrderApi(
  id: string,
  body: {
    status?: OrderStatus;
    shipmentId?: string;
    trackingId?: string;
    deliveryPartner?: string;
    estimatedShippingDate?: string;
    estimatedDeliveryDate?: string;
    location?: string;
    note?: string;
    returnReason?: string;
    generateRefund?: boolean;
    refundedAmount?: number;
    paymentStatus?: "Success" | "Pending" | "Failed";
    collectCod?: boolean;
  },
) {
  return fetchJson<Order>(`/api/logistics/orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export type CodActionResult = {
  cod?: Order["codDelivery"];
  order?: Order;
  alreadyVerified?: boolean;
  alreadyCollected?: boolean;
  devCode?: string;
  razorpayOrderId?: string;
  amount?: number;
  currency?: string;
  paymentId?: string;
  keyId?: string;
  orderNumber?: string;
};

export function postLogisticsCodAction(id: string, body: Record<string, unknown>) {
  return fetchJson<CodActionResult>(`/api/logistics/orders/${encodeURIComponent(id)}/cod`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function postLogisticsAttempt(
  id: string,
  body: {
    status: "attempted" | "failed" | "rescheduled" | "delivered";
    reason?: DeliveryAttemptReason;
    note?: string;
    location?: string;
    setFailedDelivery?: boolean;
  },
) {
  return fetchJson<Order>(`/api/logistics/orders/${encodeURIComponent(id)}/attempts`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function postLogisticsTracking(
  id: string,
  body: { title: string; location?: string; description?: string },
) {
  return fetchJson<Order>(`/api/logistics/orders/${encodeURIComponent(id)}/tracking`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function bulkPatchLogisticsOrders(body: {
  ids: string[];
  action:
    | { kind: "status"; status: OrderStatus }
    | { kind: "partner"; deliveryPartner: string };
}) {
  return fetchJson<{ success: number; failed: number; orders: Order[] }>("/api/logistics/orders", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const LABEL_PRINTED_KEY = "avyora:shipping-label-printed";

export function hasPrintedShippingLabel(orderId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(LABEL_PRINTED_KEY);
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, number>;
    return Boolean(map[orderId]);
  } catch {
    return false;
  }
}

export function markShippingLabelPrinted(orderId: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(LABEL_PRINTED_KEY);
    const map = (raw ? JSON.parse(raw) : {}) as Record<string, number>;
    map[orderId] = (map[orderId] ?? 0) + 1;
    window.localStorage.setItem(LABEL_PRINTED_KEY, JSON.stringify(map));
  } catch {
    // ignore storage failures
  }
}

export function getShippingLabelPrintCount(orderId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(LABEL_PRINTED_KEY);
    if (!raw) return 0;
    const map = JSON.parse(raw) as Record<string, number>;
    return Number(map[orderId] ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** Fetch server-generated label PDF (auth cookie). Never trusts client order payload. */
export async function fetchShippingLabelPdf(
  orderId: string,
  action: "preview" | "print" | "reprint" = "preview",
): Promise<{ ok: true; blob: Blob } | { ok: false; error: string; status?: number }> {
  try {
    const res = await fetch(
      `/api/logistics/orders/${encodeURIComponent(orderId)}/label?action=${encodeURIComponent(action)}`,
      { credentials: "include", cache: "no-store" },
    );
    if (!res.ok) {
      let error = `Label request failed (${res.status})`;
      try {
        const json = (await res.json()) as { error?: string };
        if (json?.error) error = json.error;
      } catch {
        // ignore
      }
      return { ok: false, error, status: res.status };
    }
    const blob = await res.blob();
    if (blob.type && !blob.type.includes("pdf")) {
      return { ok: false, error: "Unexpected response (expected PDF)." };
    }
    return { ok: true, blob };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Network error fetching label",
    };
  }
}

export async function recordShippingLabelAction(
  orderId: string,
  action: "print" | "reprint" | "preview",
) {
  return fetchJson<{
    orderId: string;
    action: string;
    barcodeValue: string;
    qrPayload: string;
  }>(`/api/logistics/orders/${encodeURIComponent(orderId)}/label`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

/** Bulk multi-page label PDF for eligible orders only (server filters). */
export async function fetchBulkShippingLabelPdf(
  ids: string[],
): Promise<
  | { ok: true; blob: Blob; count: number; skipped: number }
  | { ok: false; error: string; status?: number }
> {
  try {
    const res = await fetch("/api/logistics/orders/labels/bulk", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) {
      let error = `Bulk label request failed (${res.status})`;
      try {
        const json = (await res.json()) as { error?: string };
        if (json?.error) error = json.error;
      } catch {
        // ignore
      }
      return { ok: false, error, status: res.status };
    }
    const blob = await res.blob();
    const count = Number(res.headers.get("X-Label-Count") ?? "0") || 0;
    const skipped = Number(res.headers.get("X-Label-Skipped") ?? "0") || 0;
    return { ok: true, blob, count, skipped };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Network error fetching bulk labels",
    };
  }
}
