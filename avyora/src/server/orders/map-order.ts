import type { OrderStatus as PrismaOrderStatus, PaymentStatus as PrismaPaymentStatus } from "@prisma/client";
import { isCodPaymentMethod } from "@/lib/payment-method";
import { decimalToNumber } from "@/server/checkout/context";
import type { Address, Order, OrderStatus, OrderTrackingEvent } from "@/store/shop-types";
import { CUSTOMER_CANCELLABLE_STATUSES } from "@/lib/order-cancel";

export const orderDetailInclude = {
  items: {
    include: {
      product: { select: { legacyId: true, id: true } },
    },
  },
  payments: { orderBy: { createdAt: "desc" as const } },
  shipments: { orderBy: { createdAt: "desc" as const } },
  statusHistory: { orderBy: { createdAt: "desc" as const } },
  customer: { include: { user: { select: { email: true } } } },
  codDelivery: true,
} as const;

export type PrismaOrderDetail = {
  id: string;
  orderNumber: string;
  customerId: string | null;
  guestEmail: string | null;
  status: PrismaOrderStatus;
  subtotal: { toNumber?: () => number } | number;
  discount: { toNumber?: () => number } | number;
  shipping: { toNumber?: () => number } | number;
  tax: { toNumber?: () => number } | number;
  total: { toNumber?: () => number } | number;
  couponCode: string | null;
  addressSnapshot: unknown;
  paymentMethod: string | null;
  trackingId: string | null;
  notes: string | null;
  giftWrap: boolean;
  giftMessage: string | null;
  shippingMethodId: string | null;
  shippingMethodName: string | null;
  cancelReason: string | null;
  returnReason: string | null;
  refundedAmount: { toNumber?: () => number } | number;
  deliveredAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: {
    id: string;
    productId: string;
    variantId: string;
    sku: string;
    name: string;
    image: string | null;
    quantity: number;
    unitPrice: { toNumber?: () => number } | number;
    deliveredAt?: Date | null;
    product?: { id: string; legacyId: string | null } | null;
  }[];
  payments: {
    id: string;
    status: PrismaPaymentStatus;
    method: string | null;
    provider: string;
    providerPaymentId: string | null;
  }[];
  shipments: {
    id: string;
    courier: string | null;
    trackingNumber: string | null;
  }[];
  statusHistory: {
    id: string;
    status: PrismaOrderStatus;
    note: string | null;
    actorEmail: string | null;
    createdAt: Date;
  }[];
  customer?: { user?: { email: string } | null } | null;
  codDelivery?: {
    otpSentAt: Date | null;
    otpExpiresAt: Date | null;
    otpVerifiedAt: Date | null;
    collectionMethod: "CASH" | "UPI" | null;
    cashCollectedAt: Date | null;
    cashCollectedBy: string | null;
    upiVerifiedAt: Date | null;
    upiProviderPaymentId: string | null;
    upiProviderOrderId: string | null;
  } | null;
};

export function mapPrismaOrderStatus(status: PrismaOrderStatus): OrderStatus {
  switch (status) {
    case "PENDING_PAYMENT":
      return "Pending Payment";
    case "PAYMENT_CONFIRMED":
    case "CONFIRMED":
      return "Confirmed";
    case "PROCESSING":
    case "PICKING":
      return "Processing";
    case "PACKED":
      return "Packed";
    case "READY_TO_SHIP":
      return "Ready to Ship";
    case "SHIPPED":
      return "Shipped";
    case "IN_TRANSIT":
      return "In Transit";
    case "OUT_FOR_DELIVERY":
      return "Out for Delivery";
    case "DELIVERED":
      return "Delivered";
    case "CANCELLED":
      return "Cancelled";
    case "FAILED_DELIVERY":
      return "Failed Delivery";
    case "RETURN_REQUESTED":
      return "Return Requested";
    case "RETURN_PICKUP":
      return "Return Pickup";
    case "RETURNED":
      return "Returned";
    case "RTO":
      return "RTO";
    case "REFUNDED":
      return "Refunded";
    default:
      return "Confirmed";
  }
}

function mapPaymentStatus(
  status: PrismaPaymentStatus | undefined,
): Order["paymentStatus"] {
  switch (status) {
    case "SUCCESS":
      return "Success";
    case "FAILED":
      return "Failed";
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
      return "Refunded";
    case "PENDING":
    default:
      return "Pending";
  }
}

function mapAddress(snapshot: unknown, fallbackId: string): Address {
  const raw = (snapshot && typeof snapshot === "object" ? snapshot : {}) as Partial<Address>;
  return {
    id: raw.id || fallbackId,
    name: String(raw.name || "Customer"),
    phone: String(raw.phone || ""),
    line1: String(raw.line1 || ""),
    line2: raw.line2 ? String(raw.line2) : undefined,
    city: String(raw.city || ""),
    state: String(raw.state || ""),
    pincode: String(raw.pincode || ""),
    isDefault: raw.isDefault,
  };
}

function statusTitle(status: OrderStatus): string {
  switch (status) {
    case "Pending Payment":
      return "Awaiting payment";
    case "Confirmed":
      return "Order confirmed";
    case "Processing":
      return "In atelier";
    case "Packed":
      return "Packed";
    case "Ready to Ship":
      return "Ready to ship";
    case "Shipped":
      return "Shipped";
    case "In Transit":
      return "In transit";
    case "Out for Delivery":
      return "Out for delivery";
    case "Delivered":
      return "Delivered";
    case "Cancelled":
      return "Cancelled";
    case "Return Requested":
      return "Return requested";
    case "Returned":
      return "Returned";
    case "Refunded":
      return "Refunded";
    default:
      return status;
  }
}

export function mapPrismaOrderToClient(order: PrismaOrderDetail): Order {
  const shopStatus = mapPrismaOrderStatus(order.status);
  const payment = order.payments[0];
  const shipment = order.shipments[0];
  const email =
    order.guestEmail ||
    order.customer?.user?.email ||
    undefined;

  const trackingEvents: OrderTrackingEvent[] = order.statusHistory.map((entry) => {
    const status = mapPrismaOrderStatus(entry.status);
    const note = entry.note?.trim() || "";
    // Return logistics stages store human labels in note (Pickup scheduled, Picked up, …).
    const returnStageTitle =
      note &&
      (status === "Return Pickup" ||
        status === "Returned" ||
        status === "Return Requested" ||
        status === "Refunded") &&
      !/^Logistics update by /i.test(note)
        ? note
        : null;
    return {
      id: entry.id,
      at: entry.createdAt.toISOString(),
      status,
      title: returnStageTitle || statusTitle(status),
      description: returnStageTitle ? undefined : note || undefined,
      updatedBy: entry.actorEmail || undefined,
      deliveryPartner: shipment?.courier || undefined,
    };
  });

  return {
    id: order.orderNumber,
    createdAt: order.createdAt.toISOString(),
    status: shopStatus,
    items: order.items.map((item) => ({
      orderItemId: item.id,
      productId: item.product?.legacyId || item.productId,
      sku: item.sku,
      name: item.name,
      image: item.image || "/products/ring-1.jpg",
      quantity: item.quantity,
      price: decimalToNumber(item.unitPrice),
      deliveredAt: item.deliveredAt?.toISOString() || order.deliveredAt?.toISOString() || undefined,
    })),
    subtotal: decimalToNumber(order.subtotal),
    discount: decimalToNumber(order.discount),
    shipping: decimalToNumber(order.shipping),
    total: decimalToNumber(order.total),
    coupon: order.couponCode || undefined,
    address: mapAddress(order.addressSnapshot, `addr-${order.id}`),
    paymentId: payment?.providerPaymentId || payment?.id || `pay-${order.id}`,
    shipmentId: shipment?.id,
    trackingId: order.trackingId || shipment?.trackingNumber || undefined,
    deliveryPartner: shipment?.courier || undefined,
    lastUpdatedAt: order.updatedAt.toISOString(),
    notes: order.notes || undefined,
    refundedAmount: decimalToNumber(order.refundedAmount) || undefined,
    deliveredAt: order.deliveredAt?.toISOString() || undefined,
    customerEmail: email,
    paymentStatus: mapPaymentStatus(payment?.status),
    paymentMethod:
      payment?.method ||
      order.paymentMethod ||
      (payment?.provider === "cod" ? "Cash on delivery" : undefined),
    tax: decimalToNumber(order.tax),
    cancelReason: order.cancelReason || undefined,
    returnReason: order.returnReason || undefined,
    shippingMethodId: order.shippingMethodId || undefined,
    shippingMethodName: order.shippingMethodName || undefined,
    giftWrap: order.giftWrap,
    giftMessage: order.giftMessage || undefined,
    trackingEvents,
    ...(isCodPaymentMethod(order.paymentMethod) || isCodPaymentMethod(payment?.method)
      ? {
          codDelivery: (() => {
            const row = order.codDelivery;
            const otpVerified = Boolean(row?.otpVerifiedAt);
            const cashOk = row?.collectionMethod === "CASH" && Boolean(row.cashCollectedAt);
            const upiOk = row?.collectionMethod === "UPI" && Boolean(row.upiVerifiedAt);
            const paymentPaid = mapPaymentStatus(payment?.status) === "Success" || cashOk || upiOk;
            let blockingReason: string | null = null;
            if (!otpVerified) blockingReason = "Delivery OTP is not verified.";
            else if (!paymentPaid) {
              blockingReason = "Collect cash or complete doorstep UPI before marking delivered.";
            }
            return {
              otpSentAt: row?.otpSentAt?.toISOString() ?? null,
              otpExpiresAt: row?.otpExpiresAt?.toISOString() ?? null,
              otpVerifiedAt: row?.otpVerifiedAt?.toISOString() ?? null,
              otpVerified,
              collectionMethod:
                row?.collectionMethod === "CASH"
                  ? ("cash" as const)
                  : row?.collectionMethod === "UPI"
                    ? ("upi" as const)
                    : null,
              cashCollectedAt: row?.cashCollectedAt?.toISOString() ?? null,
              cashCollectedBy: row?.cashCollectedBy ?? null,
              upiVerifiedAt: row?.upiVerifiedAt?.toISOString() ?? null,
              upiProviderPaymentId: row?.upiProviderPaymentId ?? null,
              upiProviderOrderId: row?.upiProviderOrderId ?? null,
              paymentPaid,
              canCompleteDelivery: otpVerified && paymentPaid,
              blockingReason,
            };
          })(),
        }
      : {}),
  };
}

export function customerOwnsOrder(
  order: { customerId: string | null; guestEmail: string | null },
  customerId: string,
  email: string,
): boolean {
  if (order.customerId && order.customerId === customerId) return true;
  const guest = order.guestEmail?.trim().toLowerCase();
  return Boolean(guest && guest === email.trim().toLowerCase());
}

export function ownershipFilter(customerId: string, email: string) {
  const normalized = email.trim().toLowerCase();
  return {
    OR: [{ customerId }, { guestEmail: normalized }],
  };
}

export function canCustomerCancelPrismaStatus(status: PrismaOrderStatus): boolean {
  return CUSTOMER_CANCELLABLE_STATUSES.includes(mapPrismaOrderStatus(status));
}
