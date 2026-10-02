export type Address = {
  id: string;
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  isDefault?: boolean;
};

export type NotificationPrefs = {
  orders: boolean;
  marketing: boolean;
  security: boolean;
};

export type CartItem = {
  productId: string;
  sku: string;
  quantity: number;
};

export type OrderStatus =
  | "Pending Payment"
  | "Confirmed"
  | "Processing"
  | "Packed"
  | "Ready to Ship"
  | "Shipped"
  | "In Transit"
  | "Out for Delivery"
  | "Delivered"
  | "Cancelled"
  | "Failed Delivery"
  | "Return Requested"
  | "Return Pickup"
  | "Returned"
  | "RTO"
  | "Refunded";

export type DeliveryAttemptReason =
  | "Customer unavailable"
  | "Incorrect address"
  | "Customer requested reschedule"
  | "Delivery refused"
  | "Other";

export type DeliveryAttempt = {
  id: string;
  attemptNumber: number;
  at: string;
  status: "attempted" | "failed" | "rescheduled" | "delivered";
  reason?: DeliveryAttemptReason;
  note?: string;
  updatedBy?: string;
  deliveryPartner?: string;
};

/** Single checkpoint in an order's shipment journey. */
export type OrderTrackingEvent = {
  id: string;
  at: string;
  status: OrderStatus | "Update";
  title: string;
  location?: string;
  description?: string;
  updatedBy?: string;
  deliveryPartner?: string;
};

export type Order = {
  id: string;
  createdAt: string;
  status: OrderStatus;
  items: {
    /** Prisma OrderItem id — required for item-level returns. */
    orderItemId?: string;
    productId: string;
    sku: string;
    name: string;
    image: string;
    quantity: number;
    price: number;
    deliveredAt?: string;
  }[];
  /** Order-level delivery timestamp (ISO). */
  deliveredAt?: string;
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  coupon?: string;
  address: Address;
  paymentId: string;
  shipmentId?: string;
  trackingId?: string;
  deliveryPartner?: string;
  estimatedShippingDate?: string;
  estimatedDeliveryDate?: string;
  lastUpdatedAt?: string;
  lastUpdatedBy?: string;
  notes?: string;
  refundedAmount?: number;
  customerEmail?: string;
  paymentStatus?: "Success" | "Pending" | "Failed" | "Cancelled" | "Refunded";
  paymentMethod?: string;
  tax?: number;
  cancelReason?: string;
  returnReason?: string;
  shippingMethodId?: string;
  shippingMethodName?: string;
  giftWrap?: boolean;
  giftMessage?: string;
  /** Chronological shipment checkpoints shown to the customer. */
  trackingEvents?: OrderTrackingEvent[];
  deliveryAttempts?: DeliveryAttempt[];
  /** COD doorstep verification (OTP + cash/UPI). Present for COD orders when loaded from API. */
  codDelivery?: {
    otpSentAt: string | null;
    otpExpiresAt: string | null;
    otpVerifiedAt: string | null;
    otpVerified: boolean;
    collectionMethod: "cash" | "upi" | null;
    cashCollectedAt: string | null;
    cashCollectedBy: string | null;
    upiVerifiedAt: string | null;
    upiProviderPaymentId: string | null;
    upiProviderOrderId: string | null;
    paymentPaid: boolean;
    canCompleteDelivery: boolean;
    blockingReason: string | null;
  };
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: "customer" | "admin";
};

export type Customer = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  /** Demo-only credential for storefront sign-in */
  password?: string;
  createdAt: string;
  status: "active" | "blocked";
  notes?: string;
  groupId?: string;
  /** Saved delivery addresses for this customer only */
  addresses?: Address[];
  emailVerified?: boolean;
  phoneVerified?: boolean;
  resetToken?: string;
  resetExpiresAt?: string;
  /** 6-digit email verification code */
  emailVerifyToken?: string;
  emailVerifyExpiresAt?: string;
  notifications?: NotificationPrefs;
  failedLogins?: number;
  lockUntil?: string;
  /** Preferred India ring size for faster checkout */
  preferredRingSize?: string;
  /** Product IDs to notify when back in stock */
  restockAlerts?: string[];
};

export type PlaceOrderInput = {
  address: Address;
  shippingMethodId?: string;
  paymentMethod?: "cod" | "razorpay";
  giftWrap?: boolean;
  giftMessage?: string;
  /** Guest contact email for order tracking & confirmation */
  contactEmail?: string;
};

export type Campaign = {
  id: string;
  title: string;
  body: string;
  image: string;
  href: string;
  active: boolean;
  type?: "seasonal" | "flash" | "product" | "category" | "bogo";
  startsAt?: string;
  endsAt?: string;
  productSlugs?: string[];
};

export type AppointmentStatus = "requested" | "confirmed" | "completed" | "cancelled" | "no-show";

export type AppointmentPurpose = "bridal" | "try-on" | "everyday" | "resize" | "care";

export type Appointment = {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  phone: string;
  date: string;
  time: string;
  purpose: AppointmentPurpose;
  guests: number;
  notes?: string;
  productSlug?: string;
  status: AppointmentStatus;
  staffNote?: string;
};

export type AuditEntry = {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
};

export type WishlistItem = string;
