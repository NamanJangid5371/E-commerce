"use client";

import { ShippingLabelActions } from "@/components/logistics/shipping-label-actions";
import { OrderTrackingCard } from "@/components/order-tracking-card";
import { formatINR } from "@/lib/format";
import { ADMIN_ORIGIN } from "@/lib/host";
import {
  fetchLogisticsOrder,
  patchLogisticsOrderApi,
  postLogisticsTracking,
} from "@/lib/logistics-api";
import {
  isDelayedShipment,
  SHIPMENT_FLOW_STATUSES,
  RETURN_FLOW_STAGES,
  canTransitionOrderStatus,
  isLogisticsReturnActionable,
  statusBadgeTone,
  type ReturnFlowStageStatus,
} from "@/lib/logistics-orders";
import { isCodPaymentMethod } from "@/lib/payment-method";
import {
  fetchLogisticsReturns,
  postLogisticsReturnAction,
  type ReturnDto,
} from "@/lib/returns-api";
import { useShopStore } from "@/store/shop-store";
import type { Order } from "@/store/shop-types";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

export default function LogisticsOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const order = useShopStore((s) => s.orders.find((item) => item.id === id));
  const mergeOrders = useShopStore((s) => s.mergeOrders);
  const deliveryPartners = useShopStore((s) => s.ops.deliveryPartners);
  const catalog = useShopStore((s) => s.catalog);

  const [statusMode, setStatusMode] = useState<"shipment" | "return">("shipment");
  const [nextStatus, setNextStatus] = useState<Order["status"]>(order?.status ?? "Confirmed");
  const [shipmentId, setShipmentId] = useState(order?.shipmentId ?? "");
  const [trackingId, setTrackingId] = useState(order?.trackingId ?? "");
  const [partner, setPartner] = useState(order?.deliveryPartner ?? "");
  const [estimatedShipDate, setEstimatedShipDate] = useState(order?.estimatedShippingDate?.slice(0, 10) ?? "");
  const [eta, setEta] = useState(order?.estimatedDeliveryDate?.slice(0, 10) ?? "");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [returnReason, setReturnReason] = useState(order?.returnReason ?? "");
  const [checkpointTitle, setCheckpointTitle] = useState("");
  const [checkpointLocation, setCheckpointLocation] = useState("");
  const [checkpointNote, setCheckpointNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!order);
  const [orderReturns, setOrderReturns] = useState<ReturnDto[]>([]);
  const [selectedReturnId, setSelectedReturnId] = useState("");
  const [nextReturnStage, setNextReturnStage] = useState<ReturnFlowStageStatus>("PICKUP_SCHEDULED");
  const [confirmProductMatch, setConfirmProductMatch] = useState(false);

  const transition = useMemo(() => {
    if (!order) return null;
    return canTransitionOrderStatus(order.status, nextStatus);
  }, [order, nextStatus]);

  const actionableReturns = useMemo(
    () => orderReturns.filter((r) => isLogisticsReturnActionable(r.status)),
    [orderReturns],
  );
  const pendingAdminReturns = useMemo(
    () => orderReturns.filter((r) => r.status === "RETURN_REQUESTED"),
    [orderReturns],
  );
  const returnFlowAvailable = actionableReturns.length > 0;

  const selectedReturn = useMemo(
    () =>
      actionableReturns.find((r) => r.id === selectedReturnId) ??
      actionableReturns[0] ??
      null,
    [actionableReturns, selectedReturnId],
  );

  const loadOrderReturns = useCallback(async (orderId: string) => {
    const res = await fetchLogisticsReturns({ orderId, page: 1 });
    if (!res.ok) return;
    const list = res.data.returns ?? [];
    setOrderReturns(list);
    const actionable = list.filter((r) => isLogisticsReturnActionable(r.status));
    setSelectedReturnId((prev) =>
      prev && actionable.some((r) => r.id === prev) ? prev : actionable[0]?.id ?? "",
    );
    if (!actionable.length) {
      setStatusMode((mode) => (mode === "return" ? "shipment" : mode));
    }
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const orderId = Array.isArray(id) ? id[0] : id;
    setLoading(true);
    void (async () => {
      const res = await fetchLogisticsOrder(orderId);
      if (cancelled) return;
      if (res.ok && res.data) mergeOrders([res.data]);
      await loadOrderReturns(orderId);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, mergeOrders, loadOrderReturns]);

  useEffect(() => {
    if (!order) return;
    setNextStatus(order.status);
    setShipmentId(order.shipmentId ?? "");
    setTrackingId(order.trackingId ?? "");
    setPartner(order.deliveryPartner ?? "");
    setEstimatedShipDate(order.estimatedShippingDate?.slice(0, 10) ?? "");
    setEta(order.estimatedDeliveryDate?.slice(0, 10) ?? "");
    setReturnReason(order.returnReason ?? "");
  }, [order]);

  useEffect(() => {
    // Return flow only after admin approval — never auto-open on bare Return Requested.
    if (returnFlowAvailable) setStatusMode("return");
    else setStatusMode((mode) => (mode === "return" ? "shipment" : mode));
  }, [returnFlowAvailable]);

  useEffect(() => {
    if (!selectedReturn) return;
    const next = RETURN_FLOW_STAGES.find((stage) => {
      if (selectedReturn.status === "RETURN_APPROVED") return stage.status === "PICKUP_SCHEDULED";
      if (selectedReturn.status === "PICKUP_SCHEDULED") return stage.status === "PICKED_UP";
      if (selectedReturn.status === "PICKED_UP") return stage.status === "IN_TRANSIT";
      if (selectedReturn.status === "IN_TRANSIT") return stage.status === "RECEIVED_AT_WAREHOUSE";
      if (
        selectedReturn.status === "RECEIVED_AT_WAREHOUSE" ||
        selectedReturn.status === "INSPECTION_PENDING"
      ) {
        return stage.status === "INSPECTION_APPROVED";
      }
      return false;
    });
    if (next) setNextReturnStage(next.status);
  }, [selectedReturn]);

  if (loading && !order) {
    return <div className="text-sm text-ink-soft">Loading logistics order…</div>;
  }

  if (!order) {
    return (
      <div>
        Order not found.{" "}
        <Link href="/logistics/orders" className="underline">
          Back to logistics orders
        </Link>
      </div>
    );
  }
  const currentOrder = order;

  async function saveShipment(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await patchLogisticsOrderApi(currentOrder.id, {
      shipmentId: shipmentId.trim() || undefined,
      trackingId: trackingId.trim() || undefined,
      deliveryPartner: partner.trim() || undefined,
      estimatedShippingDate: estimatedShipDate
        ? new Date(`${estimatedShipDate}T12:00:00`).toISOString()
        : undefined,
      estimatedDeliveryDate: eta ? new Date(`${eta}T12:00:00`).toISOString() : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setMsg(res.error || "Could not update shipment.");
      return;
    }
    mergeOrders([res.data]);
    setMsg("Shipment details updated.");
  }

  async function saveStatus(e: FormEvent) {
    e.preventDefault();
    const check = canTransitionOrderStatus(currentOrder.status, nextStatus);
    if (!check.ok) {
      setMsg(check.message);
      return;
    }

    setBusy(true);
    const res = await patchLogisticsOrderApi(currentOrder.id, {
      status: nextStatus,
      shipmentId: shipmentId.trim() || undefined,
      trackingId: trackingId.trim() || undefined,
      deliveryPartner: partner.trim() || undefined,
      estimatedShippingDate: estimatedShipDate
        ? new Date(`${estimatedShipDate}T12:00:00`).toISOString()
        : undefined,
      estimatedDeliveryDate: eta ? new Date(`${eta}T12:00:00`).toISOString() : undefined,
      location: location.trim() || undefined,
      note: note.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setMsg(res.error || "Could not update status.");
      return;
    }

    mergeOrders([res.data]);
    setLocation("");
    setNote("");
    setMsg(`Order moved to ${nextStatus}.`);
  }

  async function addCheckpoint(e: FormEvent) {
    e.preventDefault();
    if (!checkpointTitle.trim()) {
      setMsg("Checkpoint title is required.");
      return;
    }
    setBusy(true);
    const res = await postLogisticsTracking(currentOrder.id, {
      title: checkpointTitle.trim(),
      location: checkpointLocation.trim() || undefined,
      description: checkpointNote.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setMsg(res.error || "Could not add tracking event.");
      return;
    }
    mergeOrders([res.data]);
    setCheckpointTitle("");
    setCheckpointLocation("");
    setCheckpointNote("");
    setMsg("Tracking event added.");
  }

  async function applyReturnAction(
    action: string,
    label: string,
    extra?: Record<string, unknown>,
  ) {
    if (!selectedReturn || !isLogisticsReturnActionable(selectedReturn.status)) {
      setMsg("Return flow is available only after admin approves the return.");
      return;
    }
    setBusy(true);
    setMsg("");
    const res = await postLogisticsReturnAction(selectedReturn.id, {
      action,
      note: note.trim() || undefined,
      trackingNumber: trackingId.trim() || undefined,
      courier: partner.trim() || undefined,
      inspectionNotes: note.trim() || undefined,
      ...extra,
    });
    if (!res.ok) {
      setBusy(false);
      setMsg(res.error || "Could not update return status.");
      return;
    }

    const orderRes = await fetchLogisticsOrder(currentOrder.id);
    setBusy(false);
    if (orderRes.ok && orderRes.data) mergeOrders([orderRes.data]);
    await loadOrderReturns(currentOrder.id);
    setConfirmProductMatch(false);
    setNote("");
    setMsg(`Return updated to ${label}. Visible on admin and customer panels.`);
  }

  async function saveReturnStatus(e: FormEvent) {
    e.preventDefault();
    if (!selectedReturn) {
      setMsg("No approved return on this order yet. Returns start from the customer, then admin approval.");
      return;
    }
    const stage = RETURN_FLOW_STAGES.find((s) => s.status === nextReturnStage);
    if (!stage) {
      setMsg("Unsupported return stage.");
      return;
    }
    if (stage.status === "RECEIVED_AT_WAREHOUSE" && !confirmProductMatch) {
      setMsg("Confirm the received product matches the return item before warehouse receipt.");
      return;
    }
    if (stage.status === "INSPECTION_APPROVED" || stage.status === "INSPECTION_REJECTED") {
      await applyReturnAction(stage.action, stage.label, {
        note:
          stage.status === "INSPECTION_REJECTED"
            ? note.trim() || "Failed inspection"
            : note.trim() || undefined,
      });
      return;
    }

    await applyReturnAction(stage.action, stage.label, {
      confirmProductMatch: stage.status === "RECEIVED_AT_WAREHOUSE" ? true : undefined,
      expectedOrderItemId:
        stage.status === "RECEIVED_AT_WAREHOUSE" ? selectedReturn.orderItemId : undefined,
    });
  }

  const partnerRecord = deliveryPartners.find((entry) => entry.name === currentOrder.deliveryPartner);
  const returnStageOptions = RETURN_FLOW_STAGES.filter((stage) => {
    if (!selectedReturn) return true;
    if (selectedReturn.status === "RETURN_APPROVED") return stage.status === "PICKUP_SCHEDULED";
    if (selectedReturn.status === "PICKUP_SCHEDULED") {
      return stage.status === "PICKUP_SCHEDULED" || stage.status === "PICKED_UP";
    }
    if (selectedReturn.status === "PICKED_UP") {
      return stage.status === "PICKED_UP" || stage.status === "IN_TRANSIT";
    }
    if (selectedReturn.status === "IN_TRANSIT") {
      return stage.status === "IN_TRANSIT" || stage.status === "RECEIVED_AT_WAREHOUSE";
    }
    if (selectedReturn.status === "RECEIVED_AT_WAREHOUSE" || selectedReturn.status === "INSPECTION_PENDING") {
      return stage.status === "INSPECTION_APPROVED" || stage.status === "INSPECTION_REJECTED";
    }
    return stage.status === selectedReturn.status;
  });
  const inspectionReady =
    selectedReturn?.status === "INSPECTION_PENDING" ||
    selectedReturn?.status === "RECEIVED_AT_WAREHOUSE";
  const returnActionsLocked =
    !selectedReturn ||
    !isLogisticsReturnActionable(selectedReturn.status) ||
    selectedReturn.status === "INSPECTION_APPROVED";
  const lineItems = currentOrder.items.map((item) => {
    const product = catalog.find((entry) => entry.id === item.productId);
    const variant = product?.variants.find((entry) => entry.sku === item.sku);
    return {
      item,
      availableStock: variant?.stock,
      lowStock: typeof variant?.stock === "number" ? variant.stock <= 2 : false,
    };
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.16em] uppercase text-gold-deep">Logistics order</p>
          <h1 className="mt-1 break-all text-2xl font-medium tracking-tight sm:text-3xl">{currentOrder.id}</h1>
          <p className="mt-2 break-words text-sm text-ink-soft">
            {currentOrder.address.name} · {currentOrder.customerEmail ?? "Guest"} · {currentOrder.address.phone}
          </p>
        </div>
        <div className="sm:text-right">
          <p className="text-sm text-ink-soft">Current status</p>
          <p
            className={`mt-1 inline-flex rounded-full px-3 py-1 text-sm font-medium ${
              statusBadgeTone(currentOrder.status) === "rose"
                ? "bg-rose-100 text-rose-900"
                : statusBadgeTone(currentOrder.status) === "amber"
                  ? "bg-amber-100 text-amber-900"
                  : statusBadgeTone(currentOrder.status) === "blue"
                    ? "bg-sky-100 text-sky-900"
                    : statusBadgeTone(currentOrder.status) === "emerald"
                      ? "bg-emerald-100 text-emerald-900"
                      : "bg-stone-100 text-stone-900"
            }`}
          >
            {currentOrder.status}
          </p>
          <p className="mt-2 text-xs text-ink-soft">
            {isDelayedShipment(currentOrder) ? "Delayed shipment" : "Within planned delivery window"}
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-line bg-paper/60 p-5">
            <h2 className="text-lg font-medium">Order</h2>
            <div className="mt-4 space-y-3">
              {lineItems.map(({ item, availableStock, lowStock }) => (
                <div
                  key={item.sku}
                  className="flex items-start justify-between gap-4 border-b border-line pb-3 last:border-b-0"
                >
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-ink-soft">
                      {item.sku} · Qty {item.quantity}
                    </p>
                    {typeof availableStock === "number" && (
                      <p className={`mt-1 text-xs ${lowStock ? "text-amber-900" : "text-ink-soft"}`}>
                        Stock {availableStock}
                        {lowStock ? " · Low stock" : ""}
                      </p>
                    )}
                  </div>
                  <p>{formatINR(item.price * item.quantity)}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-1 text-sm text-ink-soft">
              <p>
                <span className="text-ink">Order ID:</span> {currentOrder.id}
              </p>
              <p>
                <span className="text-ink">Order date:</span>{" "}
                {new Date(currentOrder.createdAt).toLocaleString("en-IN")}
              </p>
              <p>
                <span className="text-ink">Order value:</span> {formatINR(currentOrder.total)}
              </p>
              <p>
                <span className="text-ink">Payment:</span>{" "}
                {currentOrder.codDelivery?.paymentPaid || currentOrder.paymentStatus === "Success"
                  ? "Paid"
                  : currentOrder.paymentStatus ?? "Pending"}{" "}
                · {currentOrder.paymentMethod ?? "Razorpay"}
                {currentOrder.codDelivery?.collectionMethod
                  ? ` · ${currentOrder.codDelivery.collectionMethod === "cash" ? "Cash collected" : "UPI verified"}`
                  : ""}
              </p>
              {isCodPaymentMethod(currentOrder.paymentMethod) || currentOrder.deliveryPartner ? (
                <p className="mt-2">
                  Last-mile status, attempts, and COD are managed by the{" "}
                  <Link
                    href={`/logistics/dispatch/${encodeURIComponent(currentOrder.id)}`}
                    className="underline underline-offset-2"
                  >
                    local dispatch partner desk
                  </Link>
                  . Warehouse only packs and assigns the partner below.
                </p>
              ) : null}
            </div>
          </section>

          <section className="rounded-3xl border border-line bg-paper/60 p-5">
            <h2 className="text-lg font-medium">Customer</h2>
            <div className="mt-4 space-y-1 text-sm text-ink-soft">
              <p>
                <span className="text-ink">Name:</span> {currentOrder.address.name}
              </p>
              <p>
                <span className="text-ink">Phone:</span> {currentOrder.address.phone}
              </p>
              <p>
                <span className="text-ink">Email:</span> {currentOrder.customerEmail ?? "Guest checkout"}
              </p>
              <p>
                <span className="text-ink">Shipping address:</span> {currentOrder.address.line1}
                {currentOrder.address.line2 ? `, ${currentOrder.address.line2}` : ""}, {currentOrder.address.city},{" "}
                {currentOrder.address.state} {currentOrder.address.pincode}
              </p>
            </div>
          </section>

          <OrderTrackingCard
            order={currentOrder}
            returns={orderReturns}
            returnHref={(ret) =>
              isLogisticsReturnActionable(ret.status) ? `/logistics/returns/${ret.id}` : null
            }
          />

          {pendingAdminReturns.length > 0 && !returnFlowAvailable ? (
            <p className="border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Customer requested a return
              {pendingAdminReturns[0]?.item?.name ? ` for ${pendingAdminReturns[0].item.name}` : ""}.
              Waiting for admin approval before logistics pickup can start.
              {returnReason || currentOrder.returnReason
                ? ` Reason: ${returnReason || currentOrder.returnReason}`
                : ""}
            </p>
          ) : null}
        </div>

        <div className="space-y-6">
          <section id="shipping-label" className="rounded-3xl border border-line bg-paper/60 p-5">
            <h2 className="text-lg font-medium">Shipment</h2>
            <div className="mt-3 mb-4">
              <p className="mb-2 text-[11px] uppercase tracking-widest text-ink-soft">Sticky shipping label</p>
              <ShippingLabelActions order={currentOrder} />
            </div>
            <form onSubmit={saveShipment} className="mt-4 space-y-3">
              <label className="block text-sm">
                Shipment ID
                <input
                  value={shipmentId}
                  onChange={(e) => setShipmentId(e.target.value)}
                  className="mt-1 w-full border border-line bg-transparent px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                Tracking number
                <input
                  value={trackingId}
                  onChange={(e) => setTrackingId(e.target.value)}
                  className="mt-1 w-full border border-line bg-transparent px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                Delivery partner (3rd-party)
                <select
                  value={partner}
                  onChange={(e) => setPartner(e.target.value)}
                  className="mt-1 w-full border border-line bg-transparent px-3 py-2"
                >
                  <option value="">Unassigned</option>
                  {deliveryPartners.map((entry) => (
                    <option key={entry.id} value={entry.name}>
                      {entry.name}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-ink-soft">
                  Assign the partner who will run Local Dispatch (OFD, attempts, COD).
                </span>
              </label>
              <label className="block text-sm">
                Estimated shipping date
                <input
                  type="date"
                  value={estimatedShipDate}
                  onChange={(e) => setEstimatedShipDate(e.target.value)}
                  className="mt-1 w-full border border-line bg-transparent px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                Estimated delivery date
                <input
                  type="date"
                  value={eta}
                  onChange={(e) => setEta(e.target.value)}
                  className="mt-1 w-full border border-line bg-transparent px-3 py-2"
                />
              </label>
              {partnerRecord && (
                <p className="text-xs text-ink-soft">
                  {partnerRecord.contactName ?? "Partner contact"} ·{" "}
                  {partnerRecord.phone ?? partnerRecord.email ?? "No contact info"}
                </p>
              )}
              <button type="submit" disabled={busy} className="btn-primary">
                {busy ? "Saving…" : "Save shipment details"}
              </button>
            </form>
          </section>

          <section className="rounded-3xl border border-line bg-paper/60 p-5">
            <h2 className="text-lg font-medium">Update status</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Choose shipment flow (confirmed → delivered) or return flow (pickup → warehouse).
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setStatusMode("shipment")}
                className={`min-h-11 border px-3 py-2 text-[11px] uppercase tracking-widest ${
                  statusMode === "shipment" ? "border-ink bg-ink text-ivory" : "border-line"
                }`}
              >
                Shipment flow
              </button>
              <button
                type="button"
                disabled={!returnFlowAvailable}
                title={
                  returnFlowAvailable
                    ? "Update return pickup / warehouse / inspection"
                    : pendingAdminReturns.length
                      ? "Waiting for admin to approve the return"
                      : "Available after admin approves a customer return"
                }
                onClick={() => {
                  if (!returnFlowAvailable) return;
                  setStatusMode("return");
                }}
                className={`min-h-11 border px-3 py-2 text-[11px] uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40 ${
                  statusMode === "return" ? "border-ink bg-ink text-ivory" : "border-line"
                }`}
              >
                Return flow
              </button>
            </div>
            {!returnFlowAvailable && (
              <p className="mt-2 text-xs text-ink-soft">
                {pendingAdminReturns.length
                  ? "Return flow unlocks after admin approves this return."
                  : "Return flow is available only after admin approves a customer return."}
              </p>
            )}

            {statusMode === "shipment" ? (
              <form onSubmit={saveStatus} className="mt-4 space-y-3">
                <label className="block text-sm">
                  New shipment status
                  <select
                    value={nextStatus}
                    onChange={(e) => setNextStatus(e.target.value as Order["status"])}
                    className="mt-1 w-full border border-line bg-transparent px-3 py-2"
                  >
                    {SHIPMENT_FLOW_STATUSES.filter((status) => {
                      // Last-mile statuses belong to the assigned 3rd-party partner (Local Dispatch).
                      const partnerOwned =
                        status === "Out for Delivery" ||
                        status === "Delivered" ||
                        status === "Failed Delivery";
                      if (partnerOwned && status !== currentOrder.status) return false;
                      return (
                        status === currentOrder.status ||
                        canTransitionOrderStatus(currentOrder.status, status).ok
                      );
                    }).map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                    {!SHIPMENT_FLOW_STATUSES.includes(currentOrder.status) && (
                      <option value={currentOrder.status}>{currentOrder.status}</option>
                    )}
                  </select>
                </label>
                <label className="block text-sm">
                  Location
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="City hub / courier branch"
                    className="mt-1 w-full border border-line bg-transparent px-3 py-2"
                  />
                </label>
                <label className="block text-sm">
                  Note
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional message for the tracking timeline"
                    className="mt-1 min-h-24 w-full border border-line bg-transparent px-3 py-2"
                  />
                </label>
                {transition && !transition.ok && (
                  <p className="text-sm text-red-800">{transition.message}</p>
                )}
                {msg && <p className="text-sm text-ink-soft">{msg}</p>}
                <button type="submit" disabled={busy} className="btn-primary">
                  {busy ? "Updating…" : "Update shipment status"}
                </button>
              </form>
            ) : (
              <form onSubmit={saveReturnStatus} className="mt-4 space-y-3">
                {!returnFlowAvailable ? (
                  <p className="text-sm text-amber-900">
                    {pendingAdminReturns.length
                      ? "A return was requested by the customer. Logistics return stages unlock only after admin approval."
                      : "No admin-approved return on this order. Customer request + admin approval are required first."}
                  </p>
                ) : (
                  <>
                    {actionableReturns.length > 1 && (
                      <label className="block text-sm">
                        Return item
                        <select
                          value={selectedReturn?.id ?? ""}
                          onChange={(e) => setSelectedReturnId(e.target.value)}
                          className="mt-1 w-full border border-line bg-transparent px-3 py-2"
                        >
                          {actionableReturns.map((ret) => (
                            <option key={ret.id} value={ret.id}>
                              {ret.returnNumber} · {ret.item.name} · {ret.statusLabel}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {selectedReturn && (
                      <p className="text-sm text-ink-soft">
                        Current: <span className="text-ink">{selectedReturn.statusLabel}</span>
                        {selectedReturn.item?.name ? ` · ${selectedReturn.item.name}` : ""}
                      </p>
                    )}
                    {selectedReturn?.status === "INSPECTION_APPROVED" && (
                      <p className="text-sm text-emerald-900">
                        Inspection confirmed. Admin can mark refund eligible and generate the refund.
                      </p>
                    )}
                    {inspectionReady && selectedReturn && (
                      <div className="space-y-3 rounded-2xl border border-line bg-ivory/50 p-4">
                        <p className="text-sm text-ink">
                          Product is at warehouse. Confirm inspection for{" "}
                          <span className="font-medium">{selectedReturn.item.name}</span> (
                          {selectedReturn.item.sku}).
                        </p>
                        <label className="block text-sm">
                          Inspection notes
                          <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Condition, packaging, authenticity notes…"
                            className="mt-1 min-h-20 w-full border border-line bg-transparent px-3 py-2"
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void applyReturnAction("approve_inspection", "Inspection confirmed", {
                                inspectionNotes: note.trim() || undefined,
                              })
                            }
                            className="border border-ink bg-ink px-3 py-2 text-[11px] uppercase tracking-widest text-paper disabled:opacity-50"
                          >
                            {busy ? "Saving…" : "Confirm inspection"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void applyReturnAction("reject_inspection", "Inspection rejected", {
                                note: note.trim() || "Failed inspection",
                                inspectionNotes: note.trim() || undefined,
                              })
                            }
                            className="border border-line px-3 py-2 text-[11px] uppercase tracking-widest disabled:opacity-50"
                          >
                            Reject inspection
                          </button>
                        </div>
                      </div>
                    )}
                    {!returnActionsLocked && !inspectionReady && (
                      <>
                        <label className="block text-sm">
                          Return status
                          <select
                            value={nextReturnStage}
                            onChange={(e) =>
                              setNextReturnStage(e.target.value as ReturnFlowStageStatus)
                            }
                            className="mt-1 w-full border border-line bg-transparent px-3 py-2"
                          >
                            {returnStageOptions.map((stage) => (
                              <option key={stage.status} value={stage.status}>
                                {stage.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        {nextReturnStage === "RECEIVED_AT_WAREHOUSE" && selectedReturn && (
                          <label className="flex items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={confirmProductMatch}
                              onChange={(e) => setConfirmProductMatch(e.target.checked)}
                              className="mt-1"
                            />
                            <span>
                              I confirm the received product matches order item{" "}
                              {selectedReturn.item.sku} ({selectedReturn.item.name}).
                            </span>
                          </label>
                        )}
                        <label className="block text-sm">
                          Note
                          <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Optional note for admin and customer timelines"
                            className="mt-1 min-h-24 w-full border border-line bg-transparent px-3 py-2"
                          />
                        </label>
                        <button type="submit" disabled={busy} className="btn-primary">
                          {busy ? "Updating…" : "Update return status"}
                        </button>
                      </>
                    )}
                  </>
                )}
                {msg && <p className="text-sm text-ink-soft">{msg}</p>}
              </form>
            )}
          </section>

          <section className="rounded-3xl border border-line bg-paper/60 p-5">
            <h2 className="text-lg font-medium">Delivery attempts</h2>
            <p className="mt-2 text-sm text-ink-soft">
              Recorded by the assigned delivery partner in Local Dispatch. Warehouse view is read-only.
            </p>
            <div className="mt-4 space-y-3">
              {(currentOrder.deliveryAttempts ?? []).map((attempt) => (
                <div key={attempt.id} className="rounded-2xl border border-line bg-ivory/60 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">Attempt {attempt.attemptNumber}</p>
                    <time className="text-xs text-ink-soft">{new Date(attempt.at).toLocaleString("en-IN")}</time>
                  </div>
                  <p className="mt-1 text-ink-soft">
                    {attempt.reason ?? "No reason"}
                    {attempt.deliveryPartner ? ` · ${attempt.deliveryPartner}` : ""}
                  </p>
                  {attempt.note && <p className="mt-1 text-ink-soft">{attempt.note}</p>}
                  {attempt.updatedBy && <p className="mt-1 text-xs text-ink-soft">Updated by {attempt.updatedBy}</p>}
                </div>
              ))}
              {!currentOrder.deliveryAttempts?.length && (
                <p className="text-sm text-ink-soft">No delivery attempts recorded yet.</p>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-line bg-paper/60 p-5">
            <h2 className="text-lg font-medium">Add tracking event</h2>
            <form onSubmit={addCheckpoint} className="mt-4 space-y-3">
              <label className="block text-sm">
                Event title
                <input
                  value={checkpointTitle}
                  onChange={(e) => setCheckpointTitle(e.target.value)}
                  placeholder="Reached local hub"
                  className="mt-1 w-full border border-line bg-transparent px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                Location
                <input
                  value={checkpointLocation}
                  onChange={(e) => setCheckpointLocation(e.target.value)}
                  placeholder="Jaipur dispatch hub"
                  className="mt-1 w-full border border-line bg-transparent px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                Note
                <textarea
                  value={checkpointNote}
                  onChange={(e) => setCheckpointNote(e.target.value)}
                  placeholder="Parcel scanned and handed to the linehaul route."
                  className="mt-1 min-h-20 w-full border border-line bg-transparent px-3 py-2"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="border border-line px-4 py-2 text-[11px] uppercase tracking-widest"
              >
                Add tracking event
              </button>
            </form>
          </section>

          <section className="rounded-3xl border border-line bg-paper/60 p-5 text-sm text-ink-soft">
            <h2 className="text-lg font-medium text-ink">Actions & audit</h2>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  setStatusMode("shipment");
                  setNextStatus("Packed");
                }}
                className="inline-flex min-h-11 items-center border border-line px-3 py-2 text-[11px] uppercase tracking-widest"
              >
                Mark packed
              </button>
              <button
                type="button"
                onClick={() => {
                  setStatusMode("shipment");
                  setNextStatus("Ready to Ship");
                }}
                className="inline-flex min-h-11 items-center border border-line px-3 py-2 text-[11px] uppercase tracking-widest"
              >
                Ready to ship
              </button>
              {returnFlowAvailable && (
                <button
                  type="button"
                  onClick={() => setStatusMode("return")}
                  className="inline-flex min-h-11 items-center border border-line px-3 py-2 text-[11px] uppercase tracking-widest"
                >
                  Return stages
                </button>
              )}
            </div>
            <p className="mt-3">
              Last updated: {new Date(currentOrder.lastUpdatedAt ?? currentOrder.createdAt).toLocaleString("en-IN")}
            </p>
            <p className="mt-1">Updated by: {currentOrder.lastUpdatedBy ?? "System"}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a
                href={`${ADMIN_ORIGIN}/admin/orders/${encodeURIComponent(currentOrder.id)}`}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Open admin order
              </a>
              <Link href={`/orders/${currentOrder.id}`} target="_blank" className="underline">
                Open customer order page
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
