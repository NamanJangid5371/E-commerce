"use client";

import { seedAdminOps, type AdminOps } from "@/data/admin-ops";
import { collections as seedCollections, coupons as seedCoupons, products as seedProducts } from "@/data/catalog";
import type { Collection, Coupon, Product } from "@/data/types";
import { campaign as seedCampaign } from "@/data/content";
import { localISODate } from "@/lib/format";
import { filterRetainedOrders } from "@/lib/order-retention";
import {
  addDeliveryAttempt as appendDeliveryAttempt,
  applyOrderStatusUpdate,
  applyShipmentPatch,
  canTransitionOrderStatus,
} from "@/lib/logistics-orders";
import { isActiveAppointment, isMaisonOpen, isPastSlot, TIME_SLOTS } from "@/lib/appointments";
import {
  appendTrackingEvent,
  checkpointForStatus,
  createTrackingEvent,
  notifyTemplateForEvent,
} from "@/lib/order-tracking";
import { customerCanCancelOrder, customerCancelBlockedReason } from "@/lib/order-cancel";
import { clearAdminCookie } from "@/lib/host";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Address,
  Appointment,
  AppointmentStatus,
  AuditEntry,
  Campaign,
  CartItem,
  Customer,
  DeliveryAttemptReason,
  NotificationPrefs,
  Order,
  OrderTrackingEvent,
  PlaceOrderInput,
  User,
} from "./shop-types";

/** Staff commerce sync: merge by id; never replace a non-empty local list with []. */
function mergeStaffOrders(current: Order[], incoming: Order[] | undefined): Order[] {
  if (incoming == null) return current;
  if (!incoming.length) return current;
  const byId = new Map(current.map((order) => [order.id, order]));
  for (const order of incoming) byId.set(order.id, order);
  return Array.from(byId.values()).sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
  );
}

export type { Address, CartItem, Customer, NotificationPrefs, Order, PlaceOrderInput, User };

export function isPublished(product: Product) {
  return !product.status || product.status === "published";
}

function seedCatalog(): Product[] {
  return seedProducts.map((p) => ({
    ...p,
    status: "published" as const,
    reviews: p.reviews.map((r) => ({ ...r, status: "visible" as const })),
  }));
}

function seedCouponList(): Coupon[] {
  return seedCoupons.map((c) => ({ ...c, active: true, usageCount: 0 }));
}

function withLiveReviews(product: Product) {
  return {
    ...product,
    reviews: product.reviews.filter((r) => !r.status || r.status === "visible"),
    reviewCount: product.reviews.filter((r) => !r.status || r.status === "visible").length,
  };
}

type ShopState = {
  cart: CartItem[];
  wishlist: string[];
  user: User | null;
  orders: Order[];
  couponCode: string;
  catalog: Product[];
  collections: Collection[];
  coupons: Coupon[];
  customers: Customer[];
  campaigns: Campaign[];
  mediaUrls: string[];
  audit: AuditEntry[];
  appointments: Appointment[];
  ops: AdminOps;
  hydrated: boolean;
  setHydrated: () => void;
  addToCart: (productId: string, sku: string, quantity?: number) => void;
  /** Replace bag with a single line and go straight to checkout intent */
  buyNow: (productId: string, sku: string, quantity?: number) => boolean;
  updateQty: (sku: string, quantity: number) => void;
  removeFromCart: (sku: string) => void;
  clearCart: () => void;
  toggleWishlist: (productId: string) => void;
  applyCoupon: (code: string) => string;
  clearCoupon: () => void;
  login: (email: string, password: string) => string | null;
  staffLogin: (email: string, password: string) => string | null;
  setStaffSession: (user: { id: string; name: string; email: string }) => void;
  register: (name: string, email: string, password: string) => string | null;
  logout: () => void;
  requestPasswordReset: (email: string) => { ok: true; token?: string; message: string } | { ok: false; message: string };
  resetPassword: (email: string, token: string, password: string) => string | null;
  changePassword: (currentPassword: string, newPassword: string) => string | null;
  setDefaultAddress: (addressId: string) => void;
  resendVerification: () => string | null;
  verifyEmail: (code?: string) => void;
  updateNotifications: (prefs: Partial<NotificationPrefs>) => void;
  saveAddress: (address: Address) => void;
  removeAddress: (addressId: string) => void;
  placeOrder: (input: PlaceOrderInput) => Order | { error: string };
  /** Mirror a server-placed order into local store (cart clear, stock, confirmation email). */
  commitServerOrder: (order: Order) => void;
  mergeOrders: (orders: Order[]) => void;
  setPreferredRingSize: (size: string) => void;
  toggleRestockAlert: (productId: string) => void;
  updateOrderStatus: (
    id: string,
    status: Order["status"],
    input?: { location?: string; note?: string; updatedBy?: string },
  ) => string | null;
  updateOrder: (id: string, patch: Partial<Order>) => void;
  addOrderTrackingEvent: (
    id: string,
    input: { title: string; location?: string; description?: string; notify?: boolean },
  ) => void;
  updateOrderLogistics: (
    id: string,
    patch: Partial<Pick<Order, "shipmentId" | "trackingId" | "deliveryPartner" | "estimatedShippingDate" | "estimatedDeliveryDate">>,
  ) => void;
  addDeliveryAttempt: (
    id: string,
    input: {
      status: "attempted" | "failed" | "rescheduled" | "delivered";
      reason?: DeliveryAttemptReason;
      note?: string;
      location?: string;
    },
  ) => string | null;
  bulkUpdateLogistics: (
    ids: string[],
    input:
      | { kind: "partner"; deliveryPartner: string }
      | { kind: "status"; status: Order["status"] },
  ) => { success: number; failed: number };
  requestReturn: (id: string, reason?: string) => void;
  refundOrder: (id: string) => void;
  cancelOrder: (id: string, reason: string) => void;
  /** Customer self-service cancel before ship. Returns an error message or null on success. */
  customerCancelOrder: (id: string, reason?: string) => string | null;
  upsertProduct: (product: Product) => void;
  deleteProduct: (id: string) => void;
  setVariantStock: (productId: string, sku: string, stock: number, reason?: string) => void;
  upsertCollection: (collection: Collection) => void;
  deleteCollection: (slug: string) => void;
  /** Keep collection.productSlugs in sync when assigning from Products */
  syncProductCollectionMembership: (productSlug: string, collectionSlugs: string[], primarySlug?: string) => void;
  addProductsToCollection: (productIds: string[], collectionSlug: string) => void;
  removeProductsFromCollection: (productIds: string[], collectionSlug: string) => void;
  upsertCoupon: (coupon: Coupon) => void;
  deleteCoupon: (code: string) => void;
  upsertCustomer: (customer: Customer) => void;
  deleteCustomer: (id: string) => void;
  setReviewStatus: (productId: string, reviewId: string, status: NonNullable<Product["reviews"][0]["status"]>) => void;
  upsertCampaign: (campaign: Campaign) => void;
  addMediaUrl: (url: string) => void;
  resetCatalog: () => void;
  importCatalog: (payload: { catalog: Product[]; collections?: Collection[]; coupons?: Coupon[] }) => void;
  applyCommerce: (snapshot: {
    scope?: "public" | "staff";
    catalog?: Product[];
    collections?: Collection[];
    coupons?: Coupon[];
    customers?: Customer[];
    orders?: Order[];
    campaigns?: Campaign[];
    mediaUrls?: string[];
    audit?: AuditEntry[];
    appointments?: Appointment[];
    ops?: AdminOps;
  }) => void;
  setOps: (ops: AdminOps) => void;
  logSearch: (query: string, results: number) => void;
  logVisit: () => void;
  bookAppointment: (input: {
    name: string;
    email: string;
    phone: string;
    date: string;
    time: string;
    purpose: Appointment["purpose"];
    guests: number;
    notes?: string;
    productSlug?: string;
  }) => Promise<{ appointment: Appointment } | { error: string }>;
  updateAppointment: (
    id: string,
    patch: Partial<Pick<Appointment, "status" | "staffNote" | "date" | "time">>,
  ) => Promise<string | null>;
  cancelAppointment: (id: string, email?: string) => Promise<string | null>;
};

function findProduct(catalog: Product[], id: string) {
  return catalog.find((p) => p.id === id);
}

function couponValid(coupon: Coupon | undefined, subtotal: number) {
  if (!coupon || coupon.active === false) return false;
  if (subtotal < coupon.minOrder) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (coupon.startsAt && today < coupon.startsAt) return false;
  if (coupon.endsAt && today > coupon.endsAt) return false;
  if (coupon.usageLimit && (coupon.usageCount ?? 0) >= coupon.usageLimit) return false;
  return true;
}

function cartTotals(
  cart: CartItem[],
  couponCode: string,
  catalog: Product[],
  coupons: Coupon[],
  freeShippingMin = 7999,
  shippingCharge?: number,
  shippingFreeAbove?: number,
) {
  const lines = cart.map((item) => {
    const product = findProduct(catalog, item.productId);
    const variant = product?.variants.find((v) => v.sku === item.sku);
    const unit = variant ? variant.salePrice ?? variant.price : 0;
    return unit * item.quantity;
  });
  const subtotal = lines.reduce((a, b) => a + b, 0);
  const coupon = coupons.find((c) => c.code === couponCode.toUpperCase());
  let discount = 0;
  if (couponValid(coupon, subtotal) && coupon) {
    if (coupon.type === "percent") {
      discount = Math.round(subtotal * (coupon.value / 100));
      if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
    } else if (coupon.type === "flat") {
      discount = coupon.value;
    }
  }
  const freeShip = couponValid(coupon, subtotal) && coupon?.type === "free_shipping";
  const threshold = shippingFreeAbove ?? freeShippingMin;
  const baseCharge = shippingCharge ?? 199;
  const shipping =
    freeShip || subtotal - discount >= threshold || subtotal === 0 ? 0 : baseCharge;
  return { subtotal, discount, shipping, total: Math.max(0, subtotal - discount + shipping), coupon };
}

function audit(actor: string, action: string, detail: string): AuditEntry {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    actor,
    action,
    detail,
  };
}

function sendOrderTrackingNotification(order: Order, event: OrderTrackingEvent) {
  if (!order.customerEmail) return;
  void fetch("/api/orders/notify", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "tracking",
      templateId: notifyTemplateForEvent(event),
      orderId: order.id,
      to: order.customerEmail,
      tracking: order.trackingId,
      total: order.total,
      name: order.address.name,
      checkpoint: event.title,
      location: event.location ?? "",
      description: event.description ?? "",
    }),
  }).catch(() => undefined);
}

function sendOrderConfirmationEmail(order: Order) {
  if (!order.customerEmail) return;
  void fetch("/api/orders/notify", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "order",
      orderId: order.id,
      to: order.customerEmail,
      tracking: order.trackingId,
      total: order.total,
      name: order.address.name,
      order,
    }),
  }).catch(() => undefined);
}

function withStatusTrackingEvent(order: Order, status: Order["status"]): Order {
  const event = checkpointForStatus(order, status);
  if (!event) return order;
  return { ...order, trackingEvents: appendTrackingEvent(order, event) };
}

export const useShopStore = create<ShopState>()(
  persist(
    (set, get) => ({
      cart: [],
      wishlist: [],
      user: null,
      orders: [],
      couponCode: "",
      catalog: seedCatalog(),
      collections: seedCollections.map((c) => ({ ...c })),
      coupons: seedCouponList(),
      customers: [],
      campaigns: [
        {
          id: "camp-bridal",
          title: seedCampaign.title,
          body: seedCampaign.body,
          image: seedCampaign.image,
          href: "/shop?tag=bridal",
          active: true,
        },
      ],
      mediaUrls: [],
      audit: [],
      appointments: [],
      ops: seedAdminOps(),
      hydrated: false,
      setHydrated: () => set({ hydrated: true }),
      addToCart: (productId, sku, quantity = 1) => {
        const product = findProduct(get().catalog, productId);
        const variant = product?.variants.find((v) => v.sku === sku);
        if (!product || !isPublished(product) || !variant || variant.stock < 1) return;
        const existing = get().cart.find((i) => i.sku === sku);
        const nextQty = (existing?.quantity ?? 0) + quantity;
        if (nextQty > variant.stock) return;
        set({
          cart: existing
            ? get().cart.map((i) => (i.sku === sku ? { ...i, quantity: nextQty } : i))
            : [...get().cart, { productId, sku, quantity }],
        });
      },
      buyNow: (productId, sku, quantity = 1) => {
        const product = findProduct(get().catalog, productId);
        const variant = product?.variants.find((v) => v.sku === sku);
        if (!product || !isPublished(product) || !variant || variant.stock < quantity) return false;
        set({ cart: [{ productId, sku, quantity }] });
        return true;
      },
      updateQty: (sku, quantity) => {
        if (quantity < 1) {
          set({ cart: get().cart.filter((i) => i.sku !== sku) });
          return;
        }
        set({
          cart: get().cart.map((i) => (i.sku === sku ? { ...i, quantity } : i)),
        });
      },
      removeFromCart: (sku) => set({ cart: get().cart.filter((i) => i.sku !== sku) }),
      clearCart: () => set({ cart: [], couponCode: "" }),
      toggleWishlist: (productId) => {
        const has = get().wishlist.includes(productId);
        set({
          wishlist: has ? get().wishlist.filter((id) => id !== productId) : [...get().wishlist, productId],
        });
      },
      applyCoupon: (code) => {
        const found = get().coupons.find((c) => c.code === code.trim().toUpperCase() && c.active !== false);
        if (!found) return "This code is not valid.";
        const min = get().ops?.settings.freeShippingMin ?? 7999;
        const { subtotal } = cartTotals(get().cart, found.code, get().catalog, get().coupons, min);
        if (!couponValid(found, subtotal)) return `This code cannot be used on the current bag.`;
        set({ couponCode: found.code });
        return `Applied ${found.label}.`;
      },
      clearCoupon: () => set({ couponCode: "" }),
      login: (email, password) => {
        const normalized = email.trim().toLowerCase();
        if (!normalized.includes("@")) return "Enter a valid email address.";
        if (!password) return "Password is required.";

        const roster = get().ops?.adminUsers.find((u) => u.email.toLowerCase() === normalized);
        if (roster) {
          return "Staff accounts use the atelier staff login on port 3001 — not the customer sign-in.";
        }

        const existing = get().customers.find((c) => c.email.toLowerCase() === normalized);
        if (!existing) return "Incorrect email or password.";

        if (existing.status === "blocked") {
          return "This account is disabled. Please contact client care for help.";
        }

        if (existing.lockUntil && +new Date(existing.lockUntil) > Date.now()) {
          return "Too many attempts. Please try again in a few minutes.";
        }

        const passwordOk =
          existing.password && existing.password === password
            ? true
            : !existing.password && password.length >= 8;

        if (!passwordOk) {
          const fails = (existing.failedLogins ?? 0) + 1;
          const lockUntil = fails >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : undefined;
          set({
            customers: get().customers.map((c) =>
              c.id === existing.id
                ? { ...c, failedLogins: fails, lockUntil: lockUntil ?? c.lockUntil }
                : c,
            ),
          });
          return fails >= 5
            ? "Too many attempts. Please try again in a few minutes."
            : "Incorrect email or password.";
        }

        set({
          customers: get().customers.map((c) =>
            c.id === existing.id
              ? {
                  ...c,
                  password: c.password ?? password,
                  failedLogins: 0,
                  lockUntil: undefined,
                }
              : c,
          ),
          user: {
            id: existing.id,
            name: existing.name,
            email: existing.email,
            role: "customer",
          },
        });
        return null;
      },
      /**
       * Client-side staff session hydrate after successful `/api/auth/staff/login`.
       * Never validates passwords here — passwords are checked server-side only (bcrypt).
       * Demo password fallback is intentionally removed from production client code.
       */
      staffLogin: (email, _password) => {
        const normalized = email.trim().toLowerCase();
        if (!normalized.includes("@")) return "Enter a valid staff email.";

        const customer = get().customers.find((c) => c.email.toLowerCase() === normalized);
        if (customer && !get().ops?.adminUsers.some((u) => u.email.toLowerCase() === normalized)) {
          return "Customer accounts cannot access the admin portal. Use the storefront sign-in.";
        }

        // Offline demo login is development-only and never ships a hardcoded password.
        if (process.env.NODE_ENV === "production") {
          return "Staff sign-in requires the server. Check your connection and try again.";
        }
        if (process.env.NEXT_PUBLIC_ALLOW_DEMO_STAFF_LOGIN !== "true") {
          return "Staff sign-in requires the server. Check your connection and try again.";
        }

        const roster = get().ops?.adminUsers.find((u) => u.email.toLowerCase() === normalized && u.active);
        if (!roster) {
          return "Incorrect staff email or password.";
        }

        // Dev-only UI hydrate without privilege cookie — APIs require JWT.
        set({
          user: { id: roster.id, name: roster.name, email: roster.email, role: "admin" },
        });
        return null;
      },
      /** Apply staff user from verified API response (preferred path). */
      setStaffSession: (user: { id: string; name: string; email: string }) => {
        set({
          user: { id: user.id, name: user.name, email: user.email, role: "admin" },
        });
      },
      register: (name, email, password) => {
        const displayName = name.trim();
        const normalized = email.trim().toLowerCase();
        if (!displayName) return "Please enter your name.";
        if (!normalized.includes("@")) return "Enter a valid email address.";
        if (password.length < 8) return "Password must be at least 8 characters.";
        if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
          return "Password must include at least one letter and one number.";
        }

        const roster = get().ops?.adminUsers.find((u) => u.email.toLowerCase() === normalized);
        if (roster) return "This email is reserved for atelier staff. Use a different email for your client account.";

        const existing = get().customers.find((c) => c.email.toLowerCase() === normalized);
        if (existing) return "An account already exists for this email. Sign in instead.";

        const customer = {
          id: `c-${normalized}`,
          name: displayName,
          email: normalized,
          password,
          createdAt: new Date().toISOString(),
          status: "active" as const,
          groupId: "g-regular",
          addresses: [] as Address[],
          emailVerified: false,
          notifications: { orders: true, marketing: false, security: true },
        };

        set({
          customers: [customer, ...get().customers],
          user: {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            role: "customer",
          },
        });
        return null;
      },
      logout: () => {
        clearAdminCookie();
        set({ user: null });
      },
      requestPasswordReset: (email) => {
        const normalized = email.trim().toLowerCase();
        if (!normalized.includes("@")) return { ok: false, message: "Enter a valid email address." };
        const existing = get().customers.find((c) => c.email.toLowerCase() === normalized);
        if (!existing) return { ok: false, message: `No account exists for ${normalized}.` };
        if (existing.status === "blocked") {
          return { ok: false, message: "This account is not available for password recovery." };
        }
        const message = "A 6-digit recovery code has been sent. Check your inbox.";
        const token = String(Math.floor(100000 + Math.random() * 900000));
        set({
          customers: get().customers.map((c) =>
            c.id === existing.id
              ? {
                  ...c,
                  resetToken: token,
                  resetExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                }
              : c,
          ),
        });
        // Demo: return token so the UI can complete reset without email delivery.
        return { ok: true, message, token };
      },
      resetPassword: (email, token, password) => {
        const normalized = email.trim().toLowerCase();
        const code = token.trim().replace(/\s+/g, "");
        if (password.length < 8) return "Password must be at least 8 characters.";
        if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
          return "Password must include at least one letter and one number.";
        }
        if (!/^\d{6}$/.test(code)) return "Enter the 6-digit recovery code from your email.";
        const existing = get().customers.find((c) => c.email.toLowerCase() === normalized);
        if (!existing || !existing.resetToken || existing.resetToken !== code) {
          return "This recovery code is invalid or has expired.";
        }
        if (existing.resetExpiresAt && +new Date(existing.resetExpiresAt) < Date.now()) {
          return "This recovery code has expired. Request a new one.";
        }
        set({
          customers: get().customers.map((c) =>
            c.id === existing.id
              ? {
                  ...c,
                  password,
                  resetToken: undefined,
                  resetExpiresAt: undefined,
                  failedLogins: 0,
                  lockUntil: undefined,
                }
              : c,
          ),
        });
        return null;
      },
      changePassword: (currentPassword, newPassword) => {
        const user = get().user;
        if (!user || user.role !== "customer") return "Sign in to change your password.";
        const existing = get().customers.find((c) => c.email.toLowerCase() === user.email.toLowerCase());
        if (!existing) return "Account not found.";
        if (!existing.password || existing.password !== currentPassword) {
          return "Current password is incorrect.";
        }
        if (newPassword.length < 8) return "New password must be at least 8 characters.";
        if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
          return "Password must include at least one letter and one number.";
        }
        if (newPassword === currentPassword) return "Choose a password different from your current one.";
        set({
          customers: get().customers.map((c) =>
            c.id === existing.id ? { ...c, password: newPassword } : c,
          ),
        });
        return null;
      },
      setDefaultAddress: (addressId) => {
        const user = get().user;
        if (!user || user.role !== "customer") return;
        const email = user.email.toLowerCase();
        set({
          customers: get().customers.map((c) =>
            c.email.toLowerCase() === email
              ? {
                  ...c,
                  addresses: (c.addresses ?? []).map((a) => ({
                    ...a,
                    isDefault: a.id === addressId,
                  })),
                }
              : c,
          ),
        });
      },
      resendVerification: () => {
        const user = get().user;
        if (!user || user.role !== "customer") return "Sign in to verify your email.";
        const existing = get().customers.find((c) => c.email.toLowerCase() === user.email.toLowerCase());
        if (!existing) return "Account not found.";
        if (existing.emailVerified) return "Your email is already verified.";
        return null;
      },
      verifyEmail: (_code?: string) => {
        // API is source of truth for OTP validation — only mark the local UI after a successful verify call.
        const user = get().user;
        if (!user || user.role !== "customer") return;
        set({
          customers: get().customers.map((c) =>
            c.email.toLowerCase() === user.email.toLowerCase()
              ? {
                  ...c,
                  emailVerified: true,
                  emailVerifyToken: undefined,
                  emailVerifyExpiresAt: undefined,
                }
              : c,
          ),
        });
      },
      updateNotifications: (prefs) => {
        const user = get().user;
        if (!user || user.role !== "customer") return;
        set({
          customers: get().customers.map((c) =>
            c.email.toLowerCase() === user.email.toLowerCase()
              ? {
                  ...c,
                  notifications: {
                    orders: prefs.orders ?? c.notifications?.orders ?? true,
                    marketing: prefs.marketing ?? c.notifications?.marketing ?? false,
                    security: prefs.security ?? c.notifications?.security ?? true,
                  },
                }
              : c,
          ),
        });
      },
      saveAddress: (address) => {
        const user = get().user;
        // Addresses belong to a signed-in customer only — never a shared default.
        if (!user || user.role !== "customer") return;
        const email = user.email.toLowerCase();
        const customers = get().customers;
        const existing = customers.find((c) => c.email.toLowerCase() === email);
        if (!existing) {
          set({
            customers: [
              {
                id: `c-${email}`,
                name: user.name,
                email,
                createdAt: new Date().toISOString(),
                status: "active",
                addresses: [{ ...address, id: address.id || `addr-${Date.now()}`, isDefault: true }],
              },
              ...customers,
            ],
          });
          return;
        }
        const list = existing.addresses ?? [];
        const id = address.id || `addr-${Date.now()}`;
        const nextAddr = {
          ...address,
          id,
          isDefault: address.isDefault ?? (list.length === 0 || list.every((a) => !a.isDefault)),
        };
        let addresses = list.some((a) => a.id === id)
          ? list.map((a) => (a.id === id ? nextAddr : a))
          : [...list, nextAddr];
        if (nextAddr.isDefault) {
          addresses = addresses.map((a) => ({ ...a, isDefault: a.id === id }));
        }
        set({
          customers: customers.map((c) => (c.id === existing.id ? { ...c, addresses } : c)),
        });
      },
      removeAddress: (addressId) => {
        const user = get().user;
        if (!user || user.role !== "customer") return;
        const email = user.email.toLowerCase();
        set({
          customers: get().customers.map((c) => {
            if (c.email.toLowerCase() !== email) return c;
            const addresses = (c.addresses ?? []).filter((a) => a.id !== addressId);
            if (addresses.length && !addresses.some((a) => a.isDefault)) {
              addresses[0] = { ...addresses[0], isDefault: true };
            }
            return { ...c, addresses };
          }),
        });
      },
      placeOrder: (input) => {
        const { address, shippingMethodId, paymentMethod = "razorpay", giftWrap, giftMessage, contactEmail } =
          input;
        const { cart, couponCode, catalog, coupons, user, ops } = get();
        if (!cart.length) return { error: "Your bag is empty." };
        for (const item of cart) {
          const product = findProduct(catalog, item.productId);
          const variant = product?.variants.find((v) => v.sku === item.sku);
          if (!variant || variant.stock < item.quantity) {
            return { error: "A piece in your bag is no longer available in that quantity." };
          }
        }

        const methods = (ops.shippingMethods ?? []).filter((m) => m.enabled);
        const ship =
          methods.find((m) => m.id === shippingMethodId) ?? methods[0] ?? {
            id: "ship-std",
            name: "Insured standard",
            charge: 199,
            freeAbove: ops.settings.freeShippingMin ?? 7999,
          };

        const totals = cartTotals(
          cart,
          couponCode,
          catalog,
          coupons,
          ops.settings.freeShippingMin ?? 7999,
          ship.charge,
          ship.freeAbove,
        );

        const nextCatalog = catalog.map((product) => ({
          ...product,
          variants: product.variants.map((variant) => {
            const line = cart.find((i) => i.sku === variant.sku && i.productId === product.id);
            return line ? { ...variant, stock: variant.stock - line.quantity } : variant;
          }),
        }));

        const isCod = paymentMethod === "cod";
        const email =
          user?.role === "customer"
            ? user.email
            : contactEmail?.trim().toLowerCase() || undefined;

        const order: Order = {
          id: `AV${Date.now().toString().slice(-8)}`,
          createdAt: new Date().toISOString(),
          status: isCod ? "Confirmed" : "Confirmed",
          items: cart.map((item) => {
            const product = findProduct(catalog, item.productId)!;
            const variant = product.variants.find((v) => v.sku === item.sku)!;
            return {
              productId: item.productId,
              sku: item.sku,
              name: product.name,
              image: product.images[0],
              quantity: item.quantity,
              price: variant.salePrice ?? variant.price,
            };
          }),
          subtotal: totals.subtotal,
          discount: totals.discount,
          shipping: totals.shipping,
          total: totals.total,
          coupon: totals.coupon?.code,
          address,
          paymentId: isCod ? `cod_${Date.now().toString(36)}` : `pay_${Math.random().toString(36).slice(2, 12)}`,
          trackingId: `AVSHIP${Math.floor(100000 + Math.random() * 900000)}`,
          deliveryPartner: "carrier" in ship ? ship.carrier : undefined,
          customerEmail: email,
          paymentStatus: isCod ? "Pending" : "Success",
          paymentMethod: isCod ? "Cash on delivery" : "Razorpay (UPI/Cards)",
          tax: Math.round(totals.subtotal * ((ops.settings.taxPercent || 0) / 100)),
          shippingMethodId: ship.id,
          shippingMethodName: "name" in ship ? ship.name : "Insured standard",
          giftWrap: Boolean(giftWrap),
          giftMessage: giftMessage?.trim() || undefined,
          notes: giftWrap
            ? `Gift wrap${giftMessage?.trim() ? `: ${giftMessage.trim()}` : ""}`
            : undefined,
          trackingEvents: [
            createTrackingEvent({
              status: "Confirmed",
              title: "Order confirmed",
              location: "Avyora Atelier, Bengaluru",
              description: "Your order is confirmed and being prepared by our atelier team.",
            }),
          ],
        };

        const nextCoupons = totals.coupon
          ? get().coupons.map((c) =>
              c.code === totals.coupon?.code ? { ...c, usageCount: (c.usageCount ?? 0) + 1 } : c,
            )
          : get().coupons;

        // Guests keep contact on the order only; account creation is optional after pay.
        set({
          catalog: nextCatalog,
          orders: [order, ...get().orders],
          cart: [],
          couponCode: "",
          coupons: nextCoupons,
          audit: [audit(email ?? "guest", "order.created", order.id), ...get().audit].slice(0, 200),
        });
        sendOrderConfirmationEmail(order);
        return order;
      },
      commitServerOrder: (order) => {
        const { cart, catalog, coupons } = get();
        const nextCatalog = catalog.map((product) => ({
          ...product,
          variants: product.variants.map((variant) => {
            const line = order.items.find((i) => i.sku === variant.sku && i.productId === product.id);
            return line ? { ...variant, stock: Math.max(0, variant.stock - line.quantity) } : variant;
          }),
        }));
        const nextCoupons = order.coupon
          ? coupons.map((c) =>
              c.code === order.coupon ? { ...c, usageCount: (c.usageCount ?? 0) + 1 } : c,
            )
          : coupons;

        set({
          catalog: nextCatalog,
          orders: [order, ...get().orders.filter((o) => o.id !== order.id)],
          cart: cart.length ? [] : get().cart,
          couponCode: "",
          coupons: nextCoupons,
          audit: [
            audit(order.customerEmail ?? "guest", "order.created", order.id),
            ...get().audit,
          ].slice(0, 200),
        });
        sendOrderConfirmationEmail(order);
      },
      mergeOrders: (incoming) => {
        if (!incoming.length) return;
        const map = new Map(get().orders.map((order) => [order.id, order]));
        for (const order of incoming) {
          map.set(order.id, order);
        }
        set({
          orders: Array.from(map.values()).sort(
            (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
          ),
        });
      },
      setPreferredRingSize: (size) => {
        const user = get().user;
        if (!user || user.role !== "customer") return;
        set({
          customers: get().customers.map((c) =>
            c.email.toLowerCase() === user.email.toLowerCase()
              ? { ...c, preferredRingSize: size }
              : c,
          ),
        });
      },
      toggleRestockAlert: (productId) => {
        const user = get().user;
        if (!user || user.role !== "customer") return;
        set({
          customers: get().customers.map((c) => {
            if (c.email.toLowerCase() !== user.email.toLowerCase()) return c;
            const list = c.restockAlerts ?? [];
            const next = list.includes(productId)
              ? list.filter((id) => id !== productId)
              : [...list, productId];
            return { ...c, restockAlerts: next };
          }),
        });
      },
      updateOrderStatus: (id, status, input) => {
        const prev = get().orders.find((o) => o.id === id);
        if (!prev) return "Order not found.";
        if (prev.status === status) return "Order is already in that status.";
        const check = canTransitionOrderStatus(prev.status, status);
        if (!check.ok) return check.message;
        const { order: nextOrder, event } = applyOrderStatusUpdate(prev, status, {
          location: input?.location,
          note: input?.note,
          updatedBy: input?.updatedBy ?? get().user?.email ?? "admin",
        });

        set({
          orders: get().orders.map((o) => (o.id === id ? nextOrder : o)),
          audit: [audit(get().user?.email ?? "admin", "order.status", `${id} → ${status}`), ...get().audit].slice(0, 200),
        });

        if (event) sendOrderTrackingNotification(nextOrder, event);
        return null;
      },
      addOrderTrackingEvent: (id, input) => {
        const order = get().orders.find((o) => o.id === id);
        if (!order) return;

        const event = createTrackingEvent({
          status: "Update",
          title: input.title.trim(),
          location: input.location?.trim() || undefined,
          description: input.description?.trim() || undefined,
          updatedBy: get().user?.email ?? "admin",
        });

        const nextOrder: Order = {
          ...order,
          lastUpdatedAt: event.at,
          lastUpdatedBy: event.updatedBy,
          trackingEvents: appendTrackingEvent(order, event),
        };

        set({
          orders: get().orders.map((o) => (o.id === id ? nextOrder : o)),
          audit: [
            audit(get().user?.email ?? "admin", "order.tracking", `${id}: ${event.title}`),
            ...get().audit,
          ].slice(0, 200),
        });

        if (input.notify !== false) sendOrderTrackingNotification(nextOrder, event);
      },
      updateOrderLogistics: (id, patch) =>
        set({
          orders: get().orders.map((o) =>
            o.id === id
              ? {
                  ...applyShipmentPatch(o, patch),
                  lastUpdatedAt: new Date().toISOString(),
                  lastUpdatedBy: get().user?.email ?? "admin",
                }
              : o,
          ),
        }),
      addDeliveryAttempt: (id, input) => {
        const order = get().orders.find((o) => o.id === id);
        if (!order) return "Order not found.";
        const updatedBy = get().user?.email ?? "admin";
        const { order: nextOrder, event, attempt } = appendDeliveryAttempt(order, {
          ...input,
          updatedBy,
        });
        set({
          orders: get().orders.map((o) => (o.id === id ? nextOrder : o)),
          audit: [
            audit(updatedBy, "order.delivery_attempt", `${id}: attempt ${attempt.attemptNumber}`),
            ...get().audit,
          ].slice(0, 200),
        });
        sendOrderTrackingNotification(nextOrder, event);
        return null;
      },
      bulkUpdateLogistics: (ids, input) => {
        let success = 0;
        let failed = 0;

        for (const id of ids) {
          if (input.kind === "partner") {
            const order = get().orders.find((o) => o.id === id);
            if (!order) {
              failed += 1;
              continue;
            }
            get().updateOrderLogistics(id, { deliveryPartner: input.deliveryPartner });
            success += 1;
            continue;
          }

          const err = get().updateOrderStatus(id, input.status);
          if (err) failed += 1;
          else success += 1;
        }

        return { success, failed };
      },
      updateOrder: (id, patch) =>
        set({
          orders: get().orders.map((o) =>
            o.id === id
              ? { ...o, ...patch, lastUpdatedAt: new Date().toISOString(), lastUpdatedBy: get().user?.email ?? "admin" }
              : o,
          ),
        }),
      requestReturn: (id, reason) => {
        const prev = get().orders.find((o) => o.id === id);
        if (!prev || prev.status !== "Delivered") return;
        const note = (reason?.trim() || "Customer return request").slice(0, 500);
        let nextOrder = withStatusTrackingEvent(
          { ...prev, status: "Return Requested", returnReason: note },
          "Return Requested",
        );
        set({
          orders: get().orders.map((o) => (o.id === id ? nextOrder : o)),
        });
        const event = nextOrder.trackingEvents?.[0];
        if (event) sendOrderTrackingNotification(nextOrder, event);
      },
      cancelOrder: (id, reason) => {
        const prev = get().orders.find((o) => o.id === id);
        if (!prev || prev.status === "Cancelled" || prev.status === "Refunded") return;

        const nextCatalog = get().catalog.map((product) => ({
          ...product,
          variants: product.variants.map((variant) => {
            const line = prev.items.find((i) => i.sku === variant.sku && i.productId === product.id);
            return line ? { ...variant, stock: variant.stock + line.quantity } : variant;
          }),
        }));

        let nextOrder = withStatusTrackingEvent(
          { ...prev, status: "Cancelled", paymentStatus: "Cancelled", cancelReason: reason },
          "Cancelled",
        );
        set({
          catalog: nextCatalog,
          orders: get().orders.map((o) => (o.id === id ? nextOrder : o)),
          audit: [audit(get().user?.email ?? "admin", "order.cancelled", `${id}: ${reason}`), ...get().audit].slice(
            0,
            200,
          ),
        });
        const event = nextOrder.trackingEvents?.[0];
        if (event) sendOrderTrackingNotification(nextOrder, event);
      },
      customerCancelOrder: (id, reason) => {
        const user = get().user;
        if (!user || user.role !== "customer") {
          return "Sign in with your client account to cancel this order.";
        }
        const prev = get().orders.find((o) => o.id === id);
        if (!prev) return "Order not found.";
        if (!customerCanCancelOrder(prev, user.email)) {
          return customerCancelBlockedReason(prev);
        }

        const note = (reason?.trim() || "Cancelled by customer").slice(0, 200);
        get().cancelOrder(id, note);
        return null;
      },
      refundOrder: (id) => {
        const order = get().orders.find((o) => o.id === id);
        if (!order) return;
        let nextOrder = withStatusTrackingEvent(
          { ...order, status: "Refunded", refundedAmount: order.total, paymentStatus: "Refunded" },
          "Refunded",
        );
        set({
          orders: get().orders.map((o) => (o.id === id ? nextOrder : o)),
          audit: [audit(get().user?.email ?? "admin", "order.refund", id), ...get().audit].slice(0, 200),
        });
        const event = nextOrder.trackingEvents?.[0];
        if (event) sendOrderTrackingNotification(nextOrder, event);
      },
      upsertProduct: (product) => {
        const exists = get().catalog.some((p) => p.id === product.id);
        set({
          catalog: exists
            ? get().catalog.map((p) => (p.id === product.id ? product : p))
            : [product, ...get().catalog],
          audit: [
            audit(get().user?.email ?? "admin", exists ? "product.updated" : "product.created", product.name),
            ...get().audit,
          ].slice(0, 200),
        });
      },
      deleteProduct: (id) => {
        const product = findProduct(get().catalog, id);
        if (!product) return;
        set({
          catalog: get().catalog.filter((p) => p.id !== id),
          collections: get().collections.map((c) => ({
            ...c,
            productSlugs: c.productSlugs.filter((s) => s !== product.slug),
          })),
          audit: [audit(get().user?.email ?? "admin", "product.deleted", product.name), ...get().audit].slice(0, 200),
        });
      },
      setVariantStock: (productId, sku, stock, reason = "Manual adjustment") => {
        const product = findProduct(get().catalog, productId);
        const prev = product?.variants.find((v) => v.sku === sku)?.stock ?? 0;
        set({
          catalog: get().catalog.map((p) =>
            p.id === productId
              ? { ...p, variants: p.variants.map((v) => (v.sku === sku ? { ...v, stock } : v)) }
              : p,
          ),
          ops: {
            ...get().ops,
            stockMoves: [
              {
                id: `sm-${Date.now()}`,
                productId,
                sku,
                delta: stock - prev,
                reason,
                at: new Date().toISOString(),
                actor: get().user?.email ?? "admin",
              },
              ...get().ops.stockMoves,
            ].slice(0, 200),
          },
        });
      },
      upsertCollection: (collection) => {
        const exists = get().collections.some((c) => c.slug === collection.slug);
        set({
          collections: exists
            ? get().collections.map((c) => (c.slug === collection.slug ? collection : c))
            : [...get().collections, collection],
          audit: [audit(get().user?.email ?? "admin", "collection.saved", collection.name), ...get().audit].slice(0, 200),
        });
      },
      deleteCollection: (slug) => {
        const remaining = get().collections.filter((c) => c.slug !== slug);
        const fallback = remaining[0]?.slug;
        set({
          collections: remaining,
          catalog: get().catalog.map((p) => ({
            ...p,
            collection: p.collection === slug && fallback ? fallback : p.collection,
          })),
          audit: [
            audit(get().user?.email ?? "admin", "collection.deleted", slug),
            ...get().audit,
          ].slice(0, 200),
        });
      },
      syncProductCollectionMembership: (productSlug, collectionSlugs, primarySlug) => {
        const slugSet = new Set(collectionSlugs);
        if (primarySlug) slugSet.add(primarySlug);
        const collections = get().collections.map((c) => ({
          ...c,
          productSlugs: slugSet.has(c.slug)
            ? c.productSlugs.includes(productSlug)
              ? c.productSlugs
              : [...c.productSlugs, productSlug]
            : c.productSlugs.filter((s) => s !== productSlug),
        }));
        const catalog =
          primarySlug !== undefined
            ? get().catalog.map((p) => (p.slug === productSlug ? { ...p, collection: primarySlug } : p))
            : get().catalog;
        set({
          collections,
          catalog,
          audit: [
            audit(get().user?.email ?? "admin", "product.collections", productSlug),
            ...get().audit,
          ].slice(0, 200),
        });
      },
      addProductsToCollection: (productIds, collectionSlug) => {
        const slugs = get()
          .catalog.filter((p) => productIds.includes(p.id))
          .map((p) => p.slug);
        if (!slugs.length) return;
        const collection = get().collections.find((c) => c.slug === collectionSlug);
        if (!collection) return;
        set({
          collections: get().collections.map((c) =>
            c.slug === collectionSlug
              ? { ...c, productSlugs: [...new Set([...c.productSlugs, ...slugs])] }
              : c,
          ),
          audit: [
            audit(
              get().user?.email ?? "admin",
              "collection.products_added",
              `${slugs.length} → ${collection.name}`,
            ),
            ...get().audit,
          ].slice(0, 200),
        });
      },
      removeProductsFromCollection: (productIds, collectionSlug) => {
        const products = get().catalog.filter((p) => productIds.includes(p.id));
        const slugs = new Set(products.map((p) => p.slug));
        if (!slugs.size) return;
        const collection = get().collections.find((c) => c.slug === collectionSlug);
        if (!collection) return;
        const fallbackCollection = get().collections.find((c) => c.slug !== collectionSlug)?.slug;
        set({
          collections: get().collections.map((c) =>
            c.slug === collectionSlug
              ? { ...c, productSlugs: c.productSlugs.filter((s) => !slugs.has(s)) }
              : c,
          ),
          catalog: get().catalog.map((p) =>
            productIds.includes(p.id) && p.collection === collectionSlug
              ? { ...p, collection: fallbackCollection ?? p.collection }
              : p,
          ),
          audit: [
            audit(
              get().user?.email ?? "admin",
              "collection.products_removed",
              `${slugs.size} from ${collection.name}`,
            ),
            ...get().audit,
          ].slice(0, 200),
        });
      },
      upsertCoupon: (coupon) => {
        const code = coupon.code.toUpperCase();
        const next = { ...coupon, code };
        const exists = get().coupons.some((c) => c.code === code);
        set({
          coupons: exists ? get().coupons.map((c) => (c.code === code ? next : c)) : [...get().coupons, next],
        });
      },
      deleteCoupon: (code) => set({ coupons: get().coupons.filter((c) => c.code !== code) }),
      upsertCustomer: (customer) => {
        const exists = get().customers.some((c) => c.id === customer.id);
        set({
          customers: exists
            ? get().customers.map((c) => (c.id === customer.id ? customer : c))
            : [customer, ...get().customers],
          audit: [audit(get().user?.email ?? "admin", "customer.updated", customer.email), ...get().audit].slice(0, 200),
        });
      },
      deleteCustomer: (id) => {
        const customer = get().customers.find((c) => c.id === id);
        if (!customer) return;
        set({
          customers: get().customers.filter((c) => c.id !== id),
          audit: [
            audit(get().user?.email ?? "admin", "customer.deleted", customer.email),
            ...get().audit,
          ].slice(0, 200),
        });
      },
      setReviewStatus: (productId, reviewId, status) =>
        set({
          catalog: get().catalog.map((p) =>
            p.id === productId
              ? { ...p, reviews: p.reviews.map((r) => (r.id === reviewId ? { ...r, status } : r)) }
              : p,
          ),
        }),
      upsertCampaign: (campaign) => {
        const exists = get().campaigns.some((c) => c.id === campaign.id);
        set({
          campaigns: exists
            ? get().campaigns.map((c) => (c.id === campaign.id ? campaign : c))
            : [campaign, ...get().campaigns],
        });
      },
      addMediaUrl: (url) => {
        if (!url || get().mediaUrls.includes(url)) return;
        set({ mediaUrls: [url, ...get().mediaUrls] });
      },
      resetCatalog: () =>
        set({
          catalog: seedCatalog(),
          collections: seedCollections.map((c) => ({ ...c })),
          coupons: seedCouponList(),
          audit: [audit(get().user?.email ?? "admin", "catalog.reset", "Restored seed catalogue"), ...get().audit].slice(0, 200),
        }),
      importCatalog: (payload) =>
        set({
          catalog: payload.catalog,
          collections: payload.collections ?? get().collections,
          coupons: payload.coupons ?? get().coupons,
        }),
      applyCommerce: (snapshot) => {
        const publicOnly = snapshot.scope === "public";
        const current = get();
        set({
          catalog: snapshot.catalog ?? current.catalog,
          collections: snapshot.collections ?? current.collections,
          coupons: snapshot.coupons ?? current.coupons,
          // Public responses omit private slices — keep local customer/order/ops state.
          customers: publicOnly
            ? current.customers
            : snapshot.customers?.length
              ? snapshot.customers
              : (current.customers ?? []),
          orders: filterRetainedOrders(
            (publicOnly
              ? current.orders
              : mergeStaffOrders(current.orders, snapshot.orders)
            ).filter((o) => !o.id.startsWith("AVH-")),
          ),
          campaigns: snapshot.campaigns ?? current.campaigns,
          mediaUrls: snapshot.mediaUrls ?? current.mediaUrls,
          audit: publicOnly ? current.audit : (snapshot.audit ?? current.audit),
          appointments: (
            publicOnly ? current.appointments : (snapshot.appointments ?? current.appointments ?? [])
          ).filter((a) => !a.id.startsWith("apt-demo-")),
          ops: publicOnly
            ? {
                ...(current.ops ?? seedAdminOps()),
                shippingMethods:
                  snapshot.ops?.shippingMethods?.length
                    ? snapshot.ops.shippingMethods
                    : (current.ops ?? seedAdminOps()).shippingMethods,
                paymentMethods:
                  snapshot.ops?.paymentMethods?.length
                    ? snapshot.ops.paymentMethods
                    : (current.ops ?? seedAdminOps()).paymentMethods,
                settings: snapshot.ops?.settings ?? (current.ops ?? seedAdminOps()).settings,
                // Homepage creative must come from the server — otherwise new banners never appear.
                banners:
                  snapshot.ops?.banners !== undefined
                    ? snapshot.ops.banners
                    : (current.ops ?? seedAdminOps()).banners,
                homepageSections:
                  snapshot.ops?.homepageSections !== undefined
                    ? snapshot.ops.homepageSections
                    : (current.ops ?? seedAdminOps()).homepageSections,
                categories:
                  snapshot.ops?.categories?.length
                    ? snapshot.ops.categories
                    : (current.ops ?? seedAdminOps()).categories,
                menus:
                  snapshot.ops?.menus?.length
                    ? snapshot.ops.menus
                    : (current.ops ?? seedAdminOps()).menus,
                brands:
                  snapshot.ops?.brands?.length
                    ? snapshot.ops.brands
                    : (current.ops ?? seedAdminOps()).brands,
              }
            : {
                ...seedAdminOps(),
                ...(snapshot.ops ?? current.ops ?? {}),
                adminUsers:
                  snapshot.ops?.adminUsers?.length
                    ? snapshot.ops.adminUsers
                    : current.ops?.adminUsers?.length
                      ? current.ops.adminUsers
                      : seedAdminOps().adminUsers,
                visits: (() => {
                  const raw = snapshot.ops?.visits ?? current.ops?.visits ?? [];
                  if (!raw.length) return [];
                  const avg = raw.reduce((s, v) => s + v.count, 0) / raw.length;
                  if (raw.length > 60 && avg > 15) return [];
                  return raw;
                })(),
              },
        });
      },
      setOps: (ops) => set({ ops }),
      logSearch: (query, results) => {
        const q = query.trim().toLowerCase();
        if (!q) return;
        const ops = get().ops ?? seedAdminOps();
        const existing = ops.searches.find((s) => s.query === q);
        const searches = existing
          ? ops.searches.map((s) => (s.query === q ? { ...s, count: s.count + 1, results } : s))
          : [{ query: q, count: 1, results }, ...ops.searches].slice(0, 50);
        set({ ops: { ...ops, searches } });
      },
      logVisit: () => {
        const ops = get().ops ?? seedAdminOps();
        const date = localISODate();
        const visits = [...(ops.visits ?? [])];
        const index = visits.findIndex((row) => row.date === date);
        if (index >= 0) visits[index] = { date, count: visits[index].count + 1 };
        else visits.push({ date, count: 1 });
        set({ ops: { ...ops, visits: visits.slice(-400) } });
      },
      bookAppointment: async (input) => {
        const name = input.name.trim();
        const email = input.email.trim().toLowerCase();
        const phone = input.phone.trim();
        const notes = input.notes?.trim();
        if (!name || !email || !phone) return { error: "Please share your name, email and phone." };
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Please enter a valid email." };
        if (!isMaisonOpen(input.date)) return { error: "The maison is closed on Mondays. Choose Tuesday to Sunday." };
        if (!(TIME_SLOTS as readonly string[]).includes(input.time)) return { error: "Choose a visiting hour between 11:00 and 18:00." };
        if (isPastSlot(input.date, input.time)) return { error: "That hour has already passed. Please pick another." };
        const guests = Math.min(4, Math.max(1, Math.round(input.guests) || 1));

        try {
          const res = await fetch("/api/appointments", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              email,
              phone,
              date: input.date,
              time: input.time,
              purpose: input.purpose,
              guests,
              notes: notes || undefined,
              productSlug: input.productSlug,
            }),
          });
          const data = (await res.json()) as {
            appointment?: Appointment;
            error?: string | { message?: string };
          };
          if (!res.ok || !data.appointment) {
            const message =
              typeof data.error === "string"
                ? data.error
                : data.error?.message ?? "Could not save your visit. Please try again.";
            return { error: message };
          }
          const appointment = data.appointment;
          set({
            appointments: [appointment, ...get().appointments.filter((a) => a.id !== appointment.id)],
            audit: [audit(email, "appointment.booked", `${name} · ${input.date} ${input.time}`), ...get().audit].slice(0, 200),
          });
          void fetch("/api/appointments/notify", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: email,
              name,
              date: appointment.date,
              time: appointment.time,
              purpose: appointment.purpose,
              guests: appointment.guests,
              notes: appointment.notes,
            }),
          }).catch(() => undefined);
          return { appointment };
        } catch {
          return { error: "Could not save your visit. Please try again." };
        }
      },
      updateAppointment: async (id, patch) => {
        const current = get().appointments.find((a) => a.id === id);
        if (!current) return "Visit not found.";
        const next: Appointment = { ...current, ...patch };
        if (patch.date || patch.time) {
          if (!isMaisonOpen(next.date)) return "The maison is closed on Mondays.";
          if (get().appointments.some((a) => a.id !== id && a.date === next.date && a.time === next.time && isActiveAppointment(a.status))) {
            return "That hour is already reserved.";
          }
        }
        try {
          const res = await fetch(`/api/appointments/${id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          const data = (await res.json()) as { appointment?: Appointment; error?: string };
          if (!res.ok) return data.error ?? "Could not update visit.";
          const saved = data.appointment ?? next;
          set({
            appointments: get().appointments.map((a) => (a.id === id ? saved : a)),
            audit: [
              audit(get().user?.email ?? "admin", "appointment.updated", `${current.name} · ${saved.status}`),
              ...get().audit,
            ].slice(0, 200),
          });
          return null;
        } catch {
          return "Could not update visit.";
        }
      },
      cancelAppointment: async (id, email) => {
        const current = get().appointments.find((a) => a.id === id);
        if (!current) return "Visit not found.";
        if (email && current.email.toLowerCase() !== email.toLowerCase()) return "This visit is on another account.";
        if (!isActiveAppointment(current.status)) return "This visit can no longer be cancelled.";
        try {
          const res = await fetch(`/api/appointments/${id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "cancelled" }),
          });
          const data = (await res.json()) as { appointment?: Appointment; error?: string };
          if (!res.ok) return data.error ?? "Could not cancel visit.";
          const saved = data.appointment ?? { ...current, status: "cancelled" as AppointmentStatus };
          set({
            appointments: get().appointments.map((a) => (a.id === id ? saved : a)),
            audit: [audit(email ?? get().user?.email ?? "guest", "appointment.cancelled", current.name), ...get().audit].slice(0, 200),
          });
          return null;
        } catch {
          return "Could not cancel visit.";
        }
      },
    }),
    {
      name: "avyora-commerce-v2",
      skipHydration: true,
      partialize: (s) => ({
        cart: s.cart,
        wishlist: s.wishlist,
        user: s.user?.role === "admin" ? null : s.user,
        couponCode: s.couponCode,
      }),
    },
  ),
);

export function useCartTotals(shippingMethodId?: string) {
  const cart = useShopStore((s) => s.cart);
  const couponCode = useShopStore((s) => s.couponCode);
  const catalog = useShopStore((s) => s.catalog);
  const coupons = useShopStore((s) => s.coupons);
  const ops = useShopStore((s) => s.ops);
  const min = ops?.settings.freeShippingMin ?? 7999;
  const methods = (ops?.shippingMethods ?? []).filter((m) => m.enabled);
  const ship = methods.find((m) => m.id === shippingMethodId) ?? methods[0];
  return cartTotals(
    cart,
    couponCode,
    catalog,
    coupons,
    min,
    ship?.charge,
    ship?.freeAbove ?? min,
  );
}

export function computeCartTotals(
  cart: CartItem[],
  couponCode: string,
  catalog: Product[],
  coupons: Coupon[],
  freeShippingMin: number,
  shippingCharge?: number,
  shippingFreeAbove?: number,
) {
  return cartTotals(cart, couponCode, catalog, coupons, freeShippingMin, shippingCharge, shippingFreeAbove);
}

/** Addresses saved for the signed-in customer only. */
export function useCustomerAddresses() {
  const user = useShopStore((s) => s.user);
  const customers = useShopStore((s) => s.customers);
  if (!user || user.role !== "customer") return [];
  const customer = customers.find((c) => c.email.toLowerCase() === user.email.toLowerCase());
  return customer?.addresses ?? [];
}

export function useLiveCatalog() {
  const catalog = useShopStore((s) => s.catalog);
  const collections = useShopStore((s) => s.collections);
  const campaigns = useShopStore((s) => s.campaigns);
  const ops = useShopStore((s) => s.ops);
  const live = catalog.filter(isPublished).map(withLiveReviews);
  return { products: live, allProducts: catalog, collections, campaigns, ops };
}

export { seedProducts as products };
