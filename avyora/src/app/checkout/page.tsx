"use client";

import { formatINR } from "@/lib/format";
import { createTrackingEvent } from "@/lib/order-tracking";
import { lookupPincode } from "@/lib/pincode";
import { hydrateAccountAddresses, persistAccountAddress } from "@/lib/account-addresses";
import { useCartTotals, useCustomerAddresses, useShopStore } from "@/store/shop-store";
import type { Address, Order } from "@/store/shop-types";
import { Shield } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

const steps = ["Bag", "Delivery", "Payment"] as const;

const emptyForm = {
  name: "",
  phone: "",
  line1: "",
  city: "",
  state: "",
  pincode: "",
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadRazorpayScript() {
  return new Promise<boolean>((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function CheckoutPage() {
  const cart = useShopStore((s) => s.cart);
  const catalog = useShopStore((s) => s.catalog);
  const user = useShopStore((s) => s.user);
  const login = useShopStore((s) => s.login);
  const commitServerOrder = useShopStore((s) => s.commitServerOrder);
  const applyCoupon = useShopStore((s) => s.applyCoupon);
  const clearCoupon = useShopStore((s) => s.clearCoupon);
  const couponCode = useShopStore((s) => s.couponCode);
  const ops = useShopStore((s) => s.ops);
  const savedAddresses = useCustomerAddresses();
  const maintenance = ops?.settings.maintenance;
  const returnDays = ops?.settings.returnDays ?? 15;
  const router = useRouter();

  const shippingMethods = useMemo(
    () => (ops?.shippingMethods ?? []).filter((m) => m.enabled),
    [ops?.shippingMethods],
  );
  const paymentMethods = useMemo(
    () => (ops?.paymentMethods ?? []).filter((m) => m.enabled),
    [ops?.paymentMethods],
  );

  const [shipId, setShipId] = useState("");
  const [payId, setPayId] = useState("pay-razorpay");
  const [giftWrap, setGiftWrap] = useState(false);
  const [giftMessage, setGiftMessage] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [couponMsg, setCouponMsg] = useState("");
  const [pinStatus, setPinStatus] = useState("");
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("new");
  const [showLogin, setShowLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [form, setForm] = useState({
    ...emptyForm,
    name: user?.name ?? "",
  });
  const completingOrderRef = useRef(false);

  const totals = useCartTotals(shipId || shippingMethods[0]?.id);

  useEffect(() => {
    // After a successful place, the bag is cleared on purpose — do not bounce to /cart
    // and race the confirmation navigation.
    if (!cart.length && !completingOrderRef.current) router.replace("/cart");
  }, [cart.length, router]);

  useEffect(() => {
    if (shippingMethods.length && !shipId) setShipId(shippingMethods[0].id);
  }, [shippingMethods, shipId]);

  useEffect(() => {
    if (paymentMethods.length && !paymentMethods.some((p) => p.id === payId)) {
      setPayId(paymentMethods[0].id);
    }
  }, [paymentMethods, payId]);

  useEffect(() => {
    if (user?.role === "customer" && user.name && !form.name) {
      setForm((f) => ({ ...f, name: user.name }));
    }
    if (user?.role === "customer" && user.email) setGuestEmail(user.email);
  }, [user, form.name]);

  useEffect(() => {
    if (user?.role !== "customer") return;
    void hydrateAccountAddresses();
  }, [user?.email, user?.role]);

  useEffect(() => {
    const def = savedAddresses.find((a) => a.isDefault) ?? savedAddresses[0];
    if (user?.role === "customer" && def && (selectedId === "new" || !savedAddresses.some((a) => a.id === selectedId))) {
      if (!form.line1 || selectedId === "new") {
        setSelectedId(def.id);
        setForm({
          name: def.name,
          phone: def.phone,
          line1: def.line1,
          city: def.city,
          state: def.state,
          pincode: def.pincode,
        });
      }
    }
  }, [user, savedAddresses, selectedId, form.line1]);

  useEffect(() => {
    const pin = form.pincode.replace(/\D/g, "");
    if (pin.length !== 6) {
      setPinStatus("");
      return;
    }
    let cancelled = false;
    setPinStatus("Looking up PIN…");
    void lookupPincode(pin).then((hit) => {
      if (cancelled) return;
      if (hit) {
        setForm((f) => ({ ...f, city: hit.city, state: hit.state, pincode: pin }));
        setPinStatus(`Delivering to ${hit.city}, ${hit.state}`);
      } else {
        setPinStatus("PIN not found — enter city & state manually");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [form.pincode]);

  const lineItems = cart
    .map((item) => {
      const product = catalog.find((p) => p.id === item.productId);
      const variant = product?.variants.find((v) => v.sku === item.sku);
      if (!product || !variant) return null;
      return {
        name: product.name,
        detail: [variant.colour, variant.purity, variant.size ? `Size ${variant.size}` : ""]
          .filter(Boolean)
          .join(" · "),
        qty: item.quantity,
        price: (variant.salePrice ?? variant.price) * item.quantity,
        certifiedBy: product.certifiedBy,
      };
    })
    .filter(Boolean);

  const payLabel =
    payId === "pay-cod" ? `Place COD order · ${formatINR(totals.total)}` : `Pay ${formatINR(totals.total)}`;

  async function onCheckoutLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          ok?: boolean;
          data?: { user: { id: string; name: string; email: string } };
        };
        if (data.data?.user) {
          useShopStore.setState({
            user: {
              id: data.data.user.id,
              name: data.data.user.name,
              email: data.data.user.email,
              role: "customer",
            },
          });
          await hydrateAccountAddresses();
          setShowLogin(false);
          setLoginPassword("");
          return;
        }
      }
    } catch {
      /* fall through to local */
    }
    const err = login(loginEmail, loginPassword);
    if (err) {
      setLoginError(err);
      return;
    }
    const next = useShopStore.getState().user;
    if (next?.role !== "customer") {
      setLoginError("Use a customer account for checkout benefits.");
      useShopStore.getState().logout();
      return;
    }
    await hydrateAccountAddresses();
    setShowLogin(false);
    setLoginPassword("");
  }

  function applySaved(addr: Address) {
    setSelectedId(addr.id);
    setForm({
      name: addr.name,
      phone: addr.phone,
      line1: addr.line1,
      city: addr.city,
      state: addr.state,
      pincode: addr.pincode,
    });
  }

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        setSelectedId("new");
        setForm({ ...form, [key]: e.target.value });
      },
    };
  }

  function applyCode() {
    const msg = applyCoupon(couponInput);
    setCouponMsg(msg);
  }

  function buildLocalOrder(input: {
    orderId: string;
    orderNumber: string;
    total: number;
    paymentMethod: "cod" | "razorpay";
    paymentStatus: "Pending" | "Success";
    address: Address;
    contactEmail?: string;
  }): Order {
    const methods = shippingMethods;
    const ship =
      methods.find((m) => m.id === shipId) ?? methods[0] ?? {
        id: "ship-std",
        name: "Insured standard",
        carrier: "Delhivery",
        charge: 199,
        freeAbove: 7999,
        eta: "3–7 working days",
        zones: "Pan India",
        enabled: true,
      };
    const isCod = input.paymentMethod === "cod";

    return {
      id: input.orderNumber || input.orderId,
      createdAt: new Date().toISOString(),
      status: "Confirmed",
      items: cart.map((item) => {
        const product = catalog.find((p) => p.id === item.productId)!;
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
      total: input.total || totals.total,
      coupon: couponCode || undefined,
      address: input.address,
      paymentId: isCod ? `cod_${Date.now().toString(36)}` : `pay_${input.orderId.slice(-10)}`,
      trackingId: `AVSHIP${Math.floor(100000 + Math.random() * 900000)}`,
      deliveryPartner: ship.carrier,
      customerEmail: input.contactEmail,
      paymentStatus: input.paymentStatus,
      paymentMethod: isCod ? "Cash on delivery" : "Razorpay (UPI/Cards)",
      tax: Math.round(totals.subtotal * ((ops?.settings.taxPercent || 0) / 100)),
      shippingMethodId: ship.id,
      shippingMethodName: ship.name,
      giftWrap,
      giftMessage: giftMessage.trim() || undefined,
      notes: giftWrap
        ? `Gift wrap${giftMessage.trim() ? `: ${giftMessage.trim()}` : ""}`
        : undefined,
      trackingEvents: [
        createTrackingEvent({
          status: "Confirmed",
          title: "Order confirmed",
          location: "Avyora Atelier, Bengaluru",
          description: isCod
            ? "Your COD order is confirmed and being prepared by our atelier team."
            : "Payment confirmed. Your order is being prepared by our atelier team.",
        }),
      ],
    };
  }

  async function placeServerOrder(paymentMethod: "cod" | "razorpay") {
    const address: Address = {
      id: selectedId !== "new" ? selectedId : `addr-${Date.now()}`,
      ...form,
      state: form.state || "—",
      pincode: form.pincode.replace(/\D/g, "").slice(0, 6),
      isDefault: selectedId === "new" ? savedAddresses.length === 0 : undefined,
    };
    if (user?.role === "customer") {
      const saved = await persistAccountAddress(address);
      if (saved?.id) address.id = saved.id;
    }

    const contactEmail =
      user?.role === "customer" ? user.email : guestEmail.trim().toLowerCase();

    const res = await fetch("/api/checkout/place", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cart.map((item) => ({
          productId: item.productId,
          sku: item.sku,
          quantity: item.quantity,
        })),
        contactEmail,
        couponCode: couponCode || undefined,
        shippingMethodId: shipId || undefined,
        paymentMethod,
        address: {
          name: address.name,
          phone: address.phone,
          line1: address.line1,
          city: address.city,
          state: address.state,
          pincode: address.pincode,
        },
        giftWrap,
        giftMessage: giftMessage.trim() || undefined,
      }),
    });

    const payload = (await res.json()) as {
      ok?: boolean;
      error?: string | { message?: string };
      data?: {
        orderId: string;
        orderNumber: string;
        total: number;
        paymentMethod: "cod" | "razorpay";
        paymentStatus: string;
      };
    };

    if (!res.ok || !payload.ok || !payload.data) {
      const message =
        typeof payload.error === "string"
          ? payload.error
          : payload.error?.message || "Could not place order.";
      throw new Error(message);
    }

    return { address, contactEmail, placed: payload.data };
  }

  function finishLocal(order: ReturnType<typeof buildLocalOrder>) {
    completingOrderRef.current = true;
    commitServerOrder(order);
    const guest = user?.role !== "customer";
    router.push(`/orders/${order.id}${guest ? "?createAccount=1" : ""}`);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (maintenance) {
      setError("Checkout is paused while the atelier is in maintenance.");
      return;
    }
    if (!form.name || !form.phone || !form.line1 || !form.city || !form.pincode) {
      setError("Please complete delivery details.");
      return;
    }
    if (user?.role !== "customer") {
      const email = guestEmail.trim().toLowerCase();
      if (!email.includes("@")) {
        setError("Add an email so we can send your order confirmation.");
        return;
      }
    }

    const isCod = payId === "pay-cod";
    if (!isCod && !process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim()) {
      setError("Online payment is unavailable. Please use cash on delivery or try again later.");
      return;
    }

    setPaying(true);

    try {
      const { address, contactEmail, placed } = await placeServerOrder(isCod ? "cod" : "razorpay");

      if (isCod) {
        finishLocal(
          buildLocalOrder({
            orderId: placed.orderId,
            orderNumber: placed.orderNumber,
            total: placed.total,
            paymentMethod: "cod",
            paymentStatus: "Pending",
            address,
            contactEmail,
          }),
        );
        return;
      }

      const orderRes = await fetch("/api/payments/razorpay/order", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: placed.orderId }),
      });
      const orderPayload = (await orderRes.json()) as {
        ok?: boolean;
        error?: string;
        data?: { orderId?: string; keyId?: string | null; amount?: number };
      };

      if (!orderRes.ok || !orderPayload.ok || !orderPayload.data?.orderId || !orderPayload.data.keyId) {
        setError(
          orderPayload.error ||
            "Online payment could not be started. Your order is pending payment — contact support or retry from your account.",
        );
        setPaying(false);
        return;
      }

      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay) {
        setError("Could not load Razorpay checkout. Try again or use cash on delivery.");
        setPaying(false);
        return;
      }

      const amountPaise = orderPayload.data.amount ?? Math.round(placed.total * 100);
      const rzp = new window.Razorpay({
        key: orderPayload.data.keyId,
        amount: amountPaise,
        currency: "INR",
        name: ops?.settings.name ?? "Avyora",
        description: "Jewellery order",
        order_id: orderPayload.data.orderId,
        prefill: {
          name: form.name,
          email: contactEmail,
          contact: form.phone,
        },
        theme: { color: "#1c1612" },
        handler: (response: {
          razorpay_order_id?: string;
          razorpay_payment_id?: string;
          razorpay_signature?: string;
        }) => {
          void (async () => {
            if (
              !response.razorpay_order_id ||
              !response.razorpay_payment_id ||
              !response.razorpay_signature
            ) {
              setError("Payment incomplete. No charge confirmation received.");
              setPaying(false);
              return;
            }

            try {
              const verifyRes = await fetch("/api/payments/razorpay/verify", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  orderId: placed.orderId,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                }),
              });
              const verifyPayload = (await verifyRes.json().catch(() => ({}))) as {
                ok?: boolean;
                error?: string;
              };

              if (!verifyRes.ok || !verifyPayload.ok) {
                setError(
                  verifyPayload.error ||
                    "Payment verification failed. If you were charged, contact support with your payment ID.",
                );
                setPaying(false);
                return;
              }

              finishLocal(
                buildLocalOrder({
                  orderId: placed.orderId,
                  orderNumber: placed.orderNumber,
                  total: placed.total,
                  paymentMethod: "razorpay",
                  paymentStatus: "Success",
                  address,
                  contactEmail,
                }),
              );
            } catch {
              setError(
                "Could not verify payment with the server. If you were charged, contact support before retrying.",
              );
              setPaying(false);
            }
          })();
        },
        modal: {
          ondismiss: () => setPaying(false),
        },
      });
      rzp.open();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not complete checkout.";
      setError(message);
      setPaying(false);
    }
  }

  const summaryBlock = (
    <div className="space-y-4">
      <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Order summary</p>
      <ul className="space-y-3 text-sm">
        {lineItems.map((item) =>
          item ? (
            <li key={item.name + item.detail} className="flex justify-between gap-3">
              <span>
                <span className="font-medium">{item.name}</span>
                <span className="mt-0.5 block text-xs text-ink-soft">
                  ×{item.qty}
                  {item.detail ? ` · ${item.detail}` : ""}
                </span>
              </span>
              <span className="shrink-0">{formatINR(item.price)}</span>
            </li>
          ) : null,
        )}
      </ul>
      <div className="gold-line" />
      <ul className="space-y-2 text-sm">
        <li className="flex justify-between">
          <span className="text-ink-soft">Subtotal</span>
          <span>{formatINR(totals.subtotal)}</span>
        </li>
        <li className="flex justify-between">
          <span className="text-ink-soft">Discount{couponCode ? ` (${couponCode})` : ""}</span>
          <span>{formatINR(totals.discount)}</span>
        </li>
        <li className="flex justify-between">
          <span className="text-ink-soft">Shipping</span>
          <span>{totals.shipping ? formatINR(totals.shipping) : "Complimentary"}</span>
        </li>
        <li className="flex justify-between border-t border-line pt-3 font-medium">
          <span>Total</span>
          <span>{formatINR(totals.total)}</span>
        </li>
      </ul>
      <div className="border border-[rgba(138,109,69,0.28)] bg-ivory/80 px-3 py-3 text-xs text-ink-soft">
        <p className="flex items-center gap-2 text-[11px] tracking-[0.14em] uppercase text-gold-deep">
          <Shield size={12} /> Trust at pay
        </p>
        <p className="mt-1.5">BIS hallmarked · Certificate with every piece</p>
        <p>{returnDays}-day exchange on unworn jewellery · Insured shipping</p>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-14 pb-28 lg:pb-14">
      <div className="mb-10 flex flex-wrap items-center gap-3 text-[11px] tracking-[0.18em] uppercase">
        {steps.map((step, i) => (
          <span key={step} className="flex items-center gap-3">
            {i === 0 ? (
              <Link href="/cart" className="text-ink-soft transition hover:text-ink">
                {step}
              </Link>
            ) : (
              <span className={i >= 1 ? "text-ink" : "text-ink-soft"}>{step}</span>
            )}
            {i < steps.length - 1 && <span className="h-px w-8 bg-line" />}
          </span>
        ))}
      </div>

      <p className="section-kicker">Secure checkout</p>
      <h1 className="section-title">Delivery & payment</h1>
      <p className="prose-calm mt-3">
        {user?.role === "customer"
          ? "Signed in — addresses save to your account."
          : "Guest checkout is available. Create an account after you pay to track this order."}
      </p>

      {user?.role !== "customer" && (
        <div className="mt-8 border border-line bg-ivory/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">Returning client? Sign in optionally for saved addresses.</p>
            <button
              type="button"
              onClick={() => setShowLogin((v) => !v)}
              className="text-[11px] tracking-widest uppercase underline"
            >
              {showLogin ? "Hide" : "Sign in"}
            </button>
          </div>
          {showLogin && (
            <form onSubmit={onCheckoutLogin} className="mt-4 grid gap-3 sm:grid-cols-2">
              <input
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="Email"
                autoComplete="email"
                className="border border-line bg-transparent px-3 py-2.5 text-sm"
              />
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                minLength={8}
                className="border border-line bg-transparent px-3 py-2.5 text-sm"
              />
              {loginError && <p className="sm:col-span-2 text-sm text-red-800">{loginError}</p>}
              <button type="submit" className="btn-primary py-2 sm:col-span-2 sm:w-fit">
                Sign in & continue
              </button>
            </form>
          )}
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-12 grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-8">
          <div className="space-y-4">
            <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Delivery</p>

            {user?.role === "customer" && savedAddresses.length > 0 && (
              <div className="space-y-2 border border-line bg-ivory/60 p-4">
                <p className="text-xs text-ink-soft">Your saved addresses</p>
                {savedAddresses.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => applySaved(a)}
                    className={`block w-full border px-3 py-2 text-left text-sm transition ${
                      selectedId === a.id ? "border-ink bg-paper" : "border-line hover:border-ink"
                    }`}
                  >
                    <span className="font-medium">{a.name}</span>
                    <span className="mt-0.5 block text-ink-soft">
                      {a.line1}, {a.city} {a.pincode}
                      {a.phone ? ` · ${a.phone}` : ""}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId("new");
                    setForm({ ...emptyForm, name: user?.name ?? "" });
                  }}
                  className="text-[11px] tracking-widest uppercase underline"
                >
                  Use a new address
                </button>
              </div>
            )}

            {(user?.role !== "customer" || selectedId === "new" || savedAddresses.length === 0) && (
              <>
                <input className="w-full border border-line bg-transparent px-4 py-3.5" placeholder="Full name" required {...field("name")} />
                <input className="w-full border border-line bg-transparent px-4 py-3.5" placeholder="Phone" required {...field("phone")} />
                {user?.role !== "customer" && (
                  <input
                    type="email"
                    required
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    placeholder="Email for order updates"
                    className="w-full border border-line bg-transparent px-4 py-3.5"
                  />
                )}
                <input className="w-full border border-line bg-transparent px-4 py-3.5" placeholder="Address" required {...field("line1")} />
                <input
                  className="w-full border border-line bg-transparent px-4 py-3.5"
                  placeholder="PIN code"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={form.pincode}
                  onChange={(e) => {
                    setSelectedId("new");
                    setForm({ ...form, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) });
                  }}
                />
                {pinStatus && <p className="text-xs text-ink-soft">{pinStatus}</p>}
                <div className="grid grid-cols-2 gap-4">
                  <input className="border border-line bg-transparent px-4 py-3.5" placeholder="City" required {...field("city")} />
                  <input className="border border-line bg-transparent px-4 py-3.5" placeholder="State" required {...field("state")} />
                </div>
              </>
            )}

            {user?.role === "customer" && selectedId !== "new" && savedAddresses.length > 0 && (
              <p className="text-sm text-ink-soft">
                Delivering with your saved address. Choose another above, or add a new one if needed.
              </p>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Shipping</p>
            {shippingMethods.map((m) => {
              const free = totals.subtotal - totals.discount >= m.freeAbove;
              const charge = free ? 0 : m.charge;
              return (
                <label
                  key={m.id}
                  className={`flex cursor-pointer items-start justify-between gap-3 border px-4 py-3 text-sm transition ${
                    shipId === m.id ? "border-ink bg-ivory/80" : "border-line hover:border-ink"
                  }`}
                >
                  <span className="flex gap-3">
                    <input
                      type="radio"
                      name="ship"
                      checked={shipId === m.id}
                      onChange={() => setShipId(m.id)}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium">{m.name}</span>
                      <span className="mt-0.5 block text-xs text-ink-soft">
                        {m.carrier} · {m.eta} · {m.zones}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0">{charge ? formatINR(charge) : "Free"}</span>
                </label>
              );
            })}
          </div>

          <div className="space-y-3">
            <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Coupon</p>
            <div className="flex gap-2">
              <input
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
                placeholder="Code"
                className="flex-1 border border-line bg-transparent px-4 py-3 text-sm"
              />
              <button type="button" onClick={applyCode} className="border border-ink px-4 text-[11px] tracking-widest uppercase">
                Apply
              </button>
            </div>
            {couponCode && (
              <button type="button" onClick={() => clearCoupon()} className="text-xs underline text-ink-soft">
                Remove {couponCode}
              </button>
            )}
            {couponMsg && <p className="text-xs text-ink-soft">{couponMsg}</p>}
          </div>

          <div className="space-y-3 border border-line bg-ivory/50 p-4">
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={giftWrap} onChange={(e) => setGiftWrap(e.target.checked)} />
              Gift wrap & message card
            </label>
            {giftWrap && (
              <textarea
                value={giftMessage}
                onChange={(e) => setGiftMessage(e.target.value)}
                placeholder="Optional message for the card (max 120 characters)"
                maxLength={120}
                className="min-h-20 w-full border border-line bg-transparent px-3 py-2 text-sm"
              />
            )}
          </div>

          <div className="space-y-3">
            <p className="text-[11px] tracking-[0.18em] uppercase text-gold-deep">Payment</p>
            {paymentMethods.map((m) => (
              <label
                key={m.id}
                className={`flex cursor-pointer gap-3 border px-4 py-3 text-sm transition ${
                  payId === m.id ? "border-ink bg-ivory/80" : "border-line hover:border-ink"
                }`}
              >
                <input
                  type="radio"
                  name="pay"
                  checked={payId === m.id}
                  onChange={() => setPayId(m.id)}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">{m.name}</span>
                  <span className="mt-0.5 block text-xs text-ink-soft">{m.details}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="shadow-soft hidden border border-line bg-ivory/80 p-8 lg:block lg:sticky lg:top-28 lg:self-start">
          {summaryBlock}
          {error && <p className="mt-4 text-sm text-red-800">{error}</p>}
          <button type="submit" disabled={paying || !cart.length || !!maintenance} className="btn-primary mt-8 w-full">
            {maintenance ? "Checkout paused" : paying ? "Processing…" : payLabel}
          </button>
        </div>
      </form>

      {/* Mobile sticky summary + pay */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur-md lg:hidden">
        <details className="mb-2">
          <summary className="cursor-pointer text-[11px] tracking-widest uppercase text-ink-soft">
            View order summary · {formatINR(totals.total)}
          </summary>
          <div className="mt-3 max-h-48 overflow-auto">{summaryBlock}</div>
        </details>
        {error && <p className="mb-2 text-sm text-red-800">{error}</p>}
        <button
          type="button"
          disabled={paying || !cart.length || !!maintenance}
          onClick={(e) => {
            const formEl = document.querySelector("form");
            if (formEl) formEl.requestSubmit();
            else void onSubmit(e as unknown as FormEvent);
          }}
          className="btn-primary w-full py-3.5"
        >
          {maintenance ? "Checkout paused" : paying ? "Processing…" : payLabel}
        </button>
      </div>
    </div>
  );
}
