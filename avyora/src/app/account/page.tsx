"use client";

import { displayPrice } from "@/data/catalog";
import { ProductImage } from "@/components/product-image";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/cn";
import { formatINR } from "@/lib/format";
import { fetchJson, isApiOffline } from "@/lib/api-client";
import { deleteAccountAddress, hydrateAccountAddresses, persistAccountAddress } from "@/lib/account-addresses";
import { formatVisitWhen, isActiveAppointment, purposeLabel, statusLabel } from "@/lib/appointments";
import {
  downloadOrderInvoicePdf,
  isReturnLikeStatus,
  ORDER_FLOW,
  orderStatusStep,
} from "@/lib/invoice-pdf";
import { customerCanCancelOrder } from "@/lib/order-cancel";
import { customerCanRequestReturn } from "@/lib/order-return";
import { fetchAccountReturns, type ReturnDto } from "@/lib/returns-api";
import { useCustomerAddresses, useLiveCatalog, useShopStore } from "@/store/shop-store";
import type { Address, Order } from "@/store/shop-types";
import { BrandLogo } from "@/components/brand-logo";
import { OrderTrackingCard } from "@/components/order-tracking-card";
import {
  OrderReturnStatusBar,
  ReturnTrackingTimeline,
} from "@/components/return-tracking-timeline";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  ClipboardList,
  Gem,
  Heart,
  LayoutDashboard,
  LogOut,
  Menu,
  MapPin,
  RotateCcw,
  Ruler,
  Shield,
  X,
  Sparkles,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";

const SECTIONS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "orders", label: "Orders", icon: ClipboardList },
  { id: "addresses", label: "Addresses", icon: MapPin },
  { id: "wishlist", label: "Wishlist", icon: Heart },
  { id: "visits", label: "Atelier visits", icon: CalendarDays },
  { id: "certificates", label: "Certificates", icon: Gem },
  { id: "repairs", label: "Repairs", icon: Wrench },
  { id: "loyalty", label: "Loyalty", icon: Sparkles },
  { id: "referrals", label: "Referrals", icon: Users },
  { id: "ring-size", label: "Ring size", icon: Ruler },
  { id: "returns", label: "Returns & refunds", icon: RotateCcw },
  { id: "security", label: "Security", icon: Shield },
  { id: "notifications", label: "Notifications", icon: Bell },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const ACCOUNT_GROUPS: { label: string; ids: SectionId[] }[] = [
  { label: "Overview", ids: ["overview", "orders", "wishlist"] },
  { label: "Profile", ids: ["profile", "addresses", "ring-size"] },
  { label: "Atelier", ids: ["visits", "certificates", "repairs", "returns"] },
  { label: "Rewards", ids: ["loyalty", "referrals"] },
  { label: "Settings", ids: ["security", "notifications"] },
];

const emptyAddr = {
  name: "",
  phone: "",
  line1: "",
  city: "",
  state: "",
  pincode: "",
};

function AccountInner() {
  const user = useShopStore((s) => s.user);
  const hydrated = useShopStore((s) => s.hydrated);
  const orders = useShopStore((s) => s.orders);
  const customers = useShopStore((s) => s.customers);
  const wishlistIds = useShopStore((s) => s.wishlist);
  const addresses = useCustomerAddresses();
  const { products } = useLiveCatalog();
  const upsertCustomer = useShopStore((s) => s.upsertCustomer);
  const setDefaultAddress = useShopStore((s) => s.setDefaultAddress);
  const changePassword = useShopStore((s) => s.changePassword);
  const resendVerification = useShopStore((s) => s.resendVerification);
  const verifyEmail = useShopStore((s) => s.verifyEmail);
  const updateNotifications = useShopStore((s) => s.updateNotifications);
  const addToCart = useShopStore((s) => s.addToCart);
  const customerCancelOrder = useShopStore((s) => s.customerCancelOrder);
  const mergeOrders = useShopStore((s) => s.mergeOrders);
  const catalog = useShopStore((s) => s.catalog);
  const ops = useShopStore((s) => s.ops);
  const toggleWishlist = useShopStore((s) => s.toggleWishlist);
  const appointments = useShopStore((s) => s.appointments);
  const cancelAppointment = useShopStore((s) => s.cancelAppointment);
  const { toast } = useToast();
  const router = useRouter();
  const search = useSearchParams();

  const sectionParam = search.get("section") as SectionId | null;
  const [section, setSection] = useState<SectionId>(
    sectionParam && SECTIONS.some((s) => s.id === sectionParam) ? sectionParam : "overview",
  );

  const customer = useMemo(
    () => customers.find((c) => c.email.toLowerCase() === user?.email.toLowerCase()),
    [customers, user?.email],
  );

  const myOrders = useMemo(() => {
    if (!user) return [];
    return orders
      .filter((o) => o.customerEmail?.toLowerCase() === user.email.toLowerCase())
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [orders, user]);

  const [accountReturns, setAccountReturns] = useState<ReturnDto[]>([]);

  const myVisits = useMemo(() => {
    if (!user) return [];
    return appointments
      .filter((a) => a.email.toLowerCase() === user.email.toLowerCase())
      .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  }, [appointments, user]);

  const wishlist = useMemo(() => {
    return wishlistIds.map((id) => {
      const product = products.find((p) => p.id === id);
      return { id, product };
    });
  }, [wishlistIds, products]);

  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [saved, setSaved] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [addrForm, setAddrForm] = useState(emptyAddr);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addrMsg, setAddrMsg] = useState("");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [securityMsg, setSecurityMsg] = useState("");
  const [securityErr, setSecurityErr] = useState("");
  const [verifyMsg, setVerifyMsg] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);

  type CertificateRow = {
    id: string;
    number: string;
    type: string;
    issueDate?: string | null;
    product?: { name?: string; slug?: string } | null;
  };
  type RepairRow = {
    id: string;
    productName?: string | null;
    type: string;
    status: string;
    description: string;
    createdAt: string;
  };
  type LoyaltyData = {
    balance: number;
    tier?: string | null;
    transactions?: { id: string; amount: number; type: string; createdAt: string }[];
  };
  type ReferralData = {
    code: string;
    referrals?: { id: string; createdAt: string; referred?: { user?: { name?: string; email?: string } } }[];
  };

  const [certificates, setCertificates] = useState<CertificateRow[]>([]);
  const [repairs, setRepairs] = useState<RepairRow[]>([]);
  const [loyalty, setLoyalty] = useState<LoyaltyData | null>(null);
  const [referrals, setReferrals] = useState<ReferralData | null>(null);
  const [apiOffline, setApiOffline] = useState(false);
  const [ringCircumference, setRingCircumference] = useState("");
  const [ringResult, setRingResult] = useState<{ recommendedIndiaSize?: string; conversions?: Record<string, string | null> } | null>(null);
  const [ringMsg, setRingMsg] = useState("");
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!user || user.role !== "customer") {
      router.replace("/login");
      return;
    }
    setAddressesLoading(true);
    void hydrateAccountAddresses().finally(() => setAddressesLoading(false));
  }, [user, hydrated, router]);

  useEffect(() => {
    setName(user?.name ?? "");
    setPhone(customer?.phone ?? "");
  }, [user?.name, customer?.phone]);

  useEffect(() => {
    if (search.get("welcome") === "1") setWelcome(true);
    const s = search.get("section") as SectionId | null;
    if (s && SECTIONS.some((x) => x.id === s)) setSection(s);
    const codeFromLink = search.get("verifyCode");
    if (codeFromLink && /^\d{6}$/.test(codeFromLink)) setVerifyCode(codeFromLink);
  }, [search]);

  async function sendVerificationEmail() {
    if (!user) return;
    const err = resendVerification();
    if (err) {
      setVerifyMsg(err);
      return;
    }
    setVerifyBusy(true);
    setVerifyMsg("");
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) setVerifyMsg(data.message || "Could not send verification email.");
      else {
        setVerifyMsg(data.message || "Verification email sent.");
        toast("Verification email sent");
      }
    } catch {
      setVerifyMsg("Could not send verification email.");
    }
    setVerifyBusy(false);
  }

  async function confirmVerificationCode() {
    if (!user) return;
    const code = verifyCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setVerifyMsg("Enter the 6-digit code from your email.");
      return;
    }
    setVerifyBusy(true);
    setVerifyMsg("");
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, code }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) setVerifyMsg(data.message || "Could not verify email.");
      else {
        verifyEmail();
        setVerifyMsg(data.message || "Email verified.");
        toast("Email verified");
        setVerifyCode("");
      }
    } catch {
      setVerifyMsg("Could not verify email.");
    }
    setVerifyBusy(false);
  }

  useEffect(() => {
    if (!user || user.role !== "customer") return;
    let cancelled = false;

    (async () => {
      const [certRes, repairRes, loyaltyRes, referralRes, ordersRes, returnsRes] = await Promise.all([
        fetchJson<CertificateRow[]>("/api/account/certificates"),
        fetchJson<RepairRow[]>("/api/account/repairs"),
        fetchJson<LoyaltyData>("/api/account/loyalty"),
        fetchJson<ReferralData>("/api/account/referrals"),
        fetchJson<Order[]>("/api/account/orders"),
        fetchAccountReturns(),
      ]);

      if (cancelled) return;

      const offline =
        isApiOffline(certRes) ||
        isApiOffline(repairRes) ||
        isApiOffline(loyaltyRes) ||
        isApiOffline(referralRes) ||
        isApiOffline(ordersRes) ||
        isApiOffline(returnsRes);
      setApiOffline(Boolean(offline));

      if (certRes.ok) setCertificates(Array.isArray(certRes.data) ? certRes.data : []);
      if (repairRes.ok) setRepairs(Array.isArray(repairRes.data) ? repairRes.data : []);
      if (loyaltyRes.ok) setLoyalty(loyaltyRes.data ?? null);
      if (referralRes.ok) setReferrals(referralRes.data ?? null);
      if (ordersRes.ok && Array.isArray(ordersRes.data)) {
        mergeOrders(ordersRes.data);
      }
      if (returnsRes.ok) setAccountReturns(returnsRes.data.returns ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, mergeOrders]);

  if (!hydrated) {
    return <div className="px-4 py-16 text-sm text-ink-soft">Loading account…</div>;
  }

  if (!user || user.role !== "customer") {
    return <div className="px-4 py-16 text-sm text-ink-soft">Redirecting to sign in…</div>;
  }

  function go(id: SectionId) {
    setSection(id);
    router.replace(`/account?section=${id}`, { scroll: false });
  }

  function onSaveProfile(e: FormEvent) {
    e.preventDefault();
    const base = customer ?? {
      id: user!.id.startsWith("c-") ? user!.id : `c-${user!.email.toLowerCase()}`,
      email: user!.email,
      createdAt: new Date().toISOString(),
      status: "active" as const,
      addresses: [] as Address[],
    };
    upsertCustomer({
      ...base,
      name: name.trim() || user!.name,
      phone: phone.trim() || undefined,
      addresses: base.addresses ?? customer?.addresses ?? [],
    });
    useShopStore.setState({
      user: { ...user!, name: name.trim() || user!.name },
    });
    setSaved(true);
    toast("Profile saved");
    window.setTimeout(() => setSaved(false), 2000);
  }

  function onSaveAddress(e: FormEvent) {
    e.preventDefault();
    if (!addrForm.name || !addrForm.phone || !addrForm.line1 || !addrForm.city || !addrForm.state) {
      setAddrMsg("Please complete all required address fields.");
      return;
    }
    const pin = addrForm.pincode.replace(/\D/g, "");
    if (pin.length !== 6) {
      setAddrMsg("Enter a valid 6-digit PIN code.");
      return;
    }
    void (async () => {
      const saved = await persistAccountAddress({
        id: editingId ?? `addr-${Date.now()}`,
        ...addrForm,
        pincode: pin,
        state: addrForm.state,
        isDefault: editingId
          ? addresses.find((a) => a.id === editingId)?.isDefault
          : addresses.length === 0,
      });
      if (!saved) {
        setAddrMsg("Could not save address. Please sign in again and retry.");
        return;
      }
      setAddrForm(emptyAddr);
      setEditingId(null);
      setAddrMsg(editingId ? "Address updated." : "Address saved to your account.");
      toast(editingId ? "Address updated" : "Address saved");
      window.setTimeout(() => setAddrMsg(""), 2000);
    })();
  }

  function startEdit(a: Address) {
    setEditingId(a.id);
    setAddrForm({
      name: a.name,
      phone: a.phone,
      line1: a.line1,
      city: a.city,
      state: a.state,
      pincode: a.pincode,
    });
    setSection("addresses");
  }

  function onChangePassword(e: FormEvent) {
    e.preventDefault();
    setSecurityErr("");
    setSecurityMsg("");
    if (newPw !== confirmPw) {
      setSecurityErr("New passwords do not match.");
      return;
    }
    const err = changePassword(currentPw, newPw);
    if (err) {
      setSecurityErr(err);
      return;
    }
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
    setSecurityMsg("Password updated. Keep this change private.");
    toast("Password changed");
  }

  function onLogout() {
    void (async () => {
      const { logoutCustomer } = await import("@/lib/customer-auth");
      await logoutCustomer();
      toast("Signed out");
      router.replace("/");
    })();
  }

  const activeSection = SECTIONS.find((item) => item.id === section);

  return (
    <div className="flex min-h-full flex-col bg-[#f7f3eb] lg:flex-row">
      {navOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-[60] bg-black/50 lg:hidden"
          aria-label="Close account menu"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
      <aside
        className={cn(
          "account-sidebar fixed inset-y-0 left-0 z-[70] w-[min(18rem,88vw)] flex-col overflow-y-auto bg-[#12100e] text-ivory lg:sticky lg:top-28 lg:z-auto lg:flex lg:h-[calc(100vh-7rem)] lg:w-64",
          navOpen ? "flex" : "hidden lg:flex",
        )}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-6 lg:py-7">
          <div className="min-w-0">
            <BrandLogo href="/account" inverted caption="Account" size="lg" />
            <p className="mt-3 truncate text-[11px] text-ivory/45">{user.name}</p>
          </div>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center text-ivory lg:hidden"
            aria-label="Close account menu"
            onClick={() => setNavOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-5 px-3 pb-6" aria-label="Account">
          {ACCOUNT_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-2 text-[10px] tracking-[0.18em] uppercase text-ivory/35">{group.label}</p>
              {group.ids.map((id) => {
                const item = SECTIONS.find((s) => s.id === id);
                if (!item) return null;
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      go(item.id);
                      setNavOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 border-l-2 px-3 py-2 text-left text-sm transition",
                      active
                        ? "border-[#c4a574] bg-ivory/[0.07] text-ivory"
                        : "border-transparent text-ivory/55 hover:bg-ivory/[0.04] hover:text-ivory",
                    )}
                  >
                    <Icon size={15} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 p-4 text-sm">
          <p className="truncate text-ivory/70">{user.email}</p>
          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-2 text-left text-ivory/55 transition hover:text-ivory"
            >
              <LogOut size={14} /> Sign out
            </button>
            <Link href="/login?switch=1" className="text-ivory/55 transition hover:text-ivory">
              Use another account
            </Link>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-10">
      <button
        type="button"
        className="mb-5 flex min-h-11 w-full items-center justify-between gap-3 border border-line bg-paper px-4 py-2 text-left lg:hidden"
        onClick={() => setNavOpen(true)}
      >
        <span>
          <span className="block text-[10px] tracking-[0.16em] uppercase text-ink-soft">Account</span>
          <span className="text-sm">{activeSection?.label ?? "Menu"}</span>
        </span>
        <Menu size={18} />
      </button>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-kicker">My account</p>
          <h1 className="section-title">Hello, {user.name.split(" ")[0]}</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Manage your profile, orders, addresses, wishlist, and security.
          </p>
        </div>
        <button
          onClick={onLogout}
          className="text-[11px] tracking-widest uppercase text-ink-soft transition hover:text-ink lg:hidden"
        >
          Sign out
        </button>
      </div>

      {welcome && (
        <div className="mt-6 border border-line bg-ivory/80 px-5 py-4 text-sm">
          Account created. You can continue shopping anytime — your bag and wishlist stay with this browser.
          <button type="button" className="ml-3 underline" onClick={() => setWelcome(false)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="mt-10">
          {section === "overview" && (
            <section>
              <h2 className="font-serif text-3xl tracking-tight">Account summary</h2>
              <div className="gold-line mt-4" />
              <div className="mt-6 grid gap-4 sm:grid-cols-4">
                <button type="button" onClick={() => go("orders")} className="border border-line bg-paper/50 p-5 text-left">
                  <p className="text-[11px] tracking-widest uppercase text-gold-deep">Orders</p>
                  <p className="mt-2 font-serif text-3xl">{myOrders.length}</p>
                </button>
                <button type="button" onClick={() => go("visits")} className="border border-line bg-paper/50 p-5 text-left">
                  <p className="text-[11px] tracking-widest uppercase text-gold-deep">Visits</p>
                  <p className="mt-2 font-serif text-3xl">{myVisits.length}</p>
                </button>
                <button type="button" onClick={() => go("addresses")} className="border border-line bg-paper/50 p-5 text-left">
                  <p className="text-[11px] tracking-widest uppercase text-gold-deep">Addresses</p>
                  <p className="mt-2 font-serif text-3xl">{addresses.length}</p>
                </button>
                <button type="button" onClick={() => go("wishlist")} className="border border-line bg-paper/50 p-5 text-left">
                  <p className="text-[11px] tracking-widest uppercase text-gold-deep">Wishlist</p>
                  <p className="mt-2 font-serif text-3xl">{wishlistIds.length}</p>
                </button>
              </div>
              <div className="mt-8">
                <h3 className="text-sm font-medium tracking-widest uppercase text-gold-deep">Recent orders</h3>
                {!myOrders.length ? (
                  <p className="mt-3 text-sm text-ink-soft">No orders yet.</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {myOrders.slice(0, 3).map((o) => (
                      <li key={o.id} className="account-order-card account-order-card--compact">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <Link href={`/orders/${o.id}`} className="account-order-card__id">
                            {o.id}
                          </Link>
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="account-order-card__status">{o.status}</span>
                            <span className="account-order-card__total">{formatINR(o.total)}</span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="mt-6 text-sm text-ink-soft">
                Email verification:{" "}
                <span className="text-ink">{customer?.emailVerified ? "Verified" : "Pending"}</span>
              </p>
              {!customer?.emailVerified && (
                <div className="mt-3 max-w-md space-y-3">
                  <button
                    type="button"
                    disabled={verifyBusy}
                    className="underline disabled:opacity-50"
                    onClick={() => void sendVerificationEmail()}
                  >
                    {verifyBusy ? "Sending…" : "Send verification email"}
                  </button>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block flex-1 text-sm text-ink">
                      6-digit code
                      <input
                        value={verifyCode}
                        onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        className="mt-1 w-full border border-line bg-transparent px-3 py-2"
                        placeholder="123456"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={verifyBusy || verifyCode.length !== 6}
                      onClick={() => void confirmVerificationCode()}
                      className="border border-ink px-4 py-2 text-[11px] tracking-widest uppercase disabled:opacity-40"
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              )}
              {verifyMsg && <p className="mt-2 text-xs text-ink-soft">{verifyMsg}</p>}
            </section>
          )}

          {section === "profile" && (
            <section className="shadow-soft border border-line bg-ivory/70 p-6">
              <h2 className="font-serif text-3xl tracking-tight">Profile</h2>
              <div className="gold-line mt-4" />
              <form onSubmit={onSaveProfile} className="mt-6 max-w-md space-y-4">
                <label className="block text-sm">
                  Full name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 w-full border border-line bg-transparent px-3 py-2.5"
                  />
                </label>
                <label className="block text-sm">
                  Email
                  <input
                    value={user.email}
                    readOnly
                    className="mt-1 w-full border border-line bg-paper/60 px-3 py-2.5 text-ink-soft"
                  />
                  <span className="mt-1 block text-xs text-ink-soft">
                    {customer?.emailVerified ? "Verified" : "Not verified"} — contact care to change email.
                  </span>
                </label>
                <label className="block text-sm">
                  Phone
                  <input
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 …"
                    className="mt-1 w-full border border-line bg-transparent px-3 py-2.5"
                  />
                </label>
                <label className="block text-sm">
                  Preferred ring size (India)
                  <select
                    value={customer?.preferredRingSize ?? ""}
                    onChange={(e) => {
                      useShopStore.getState().setPreferredRingSize(e.target.value);
                      toast("Ring size saved");
                    }}
                    className="mt-1 w-full border border-line bg-transparent px-3 py-2.5"
                  >
                    <option value="">Select size</option>
                    {Array.from({ length: 15 }, (_, i) => String(i + 6)).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-ink-soft">
                    Pre-selects matching sizes on product pages when you shop.
                  </span>
                </label>
                <button type="submit" className="btn-primary">
                  {saved ? "Saved" : "Save changes"}
                </button>
              </form>
            </section>
          )}

          {section === "orders" && (
            <section>
              <h2 className="font-serif text-3xl tracking-tight">Orders</h2>
              <div className="gold-line mt-4" />
              {!myOrders.length ? (
                <div className="account-order-card mt-8 p-10 text-center">
                  <p className="text-sm text-ink-soft">No orders yet for this account.</p>
                  <Link href="/shop" className="btn-primary mt-6 inline-flex">
                    Browse jewellery
                  </Link>
                </div>
              ) : (
                <div className="mt-7 space-y-5">
                  {myOrders.map((o) => {
                    const step = orderStatusStep(o.status);
                    const showReturnFlow = isReturnLikeStatus(o.status);
                    const itemReturns = accountReturns.filter((r) => r.orderId === o.id);
                    const shippedAt = o.trackingEvents?.find((event) => event.status === "Shipped" || event.status === "In Transit")?.at;
                    const deliveredAt = o.trackingEvents?.find((event) => event.status === "Delivered")?.at;
                    const latest = o.trackingEvents?.[0];
                    const statusTone =
                      o.status === "Cancelled"
                        ? "is-cancelled"
                        : showReturnFlow
                          ? "is-return"
                          : "";
                    const metaBits: { key: string; node: ReactNode }[] = [
                      {
                        key: "when",
                        node: `${new Date(o.createdAt).toLocaleString("en-IN")} · ${o.items.length} item${o.items.length === 1 ? "" : "s"}`,
                      },
                      ...(o.trackingId
                        ? [
                            {
                              key: "tracking",
                              node: (
                                <>
                                  Tracking <span className="id-mono">{o.trackingId}</span>
                                </>
                              ),
                            },
                          ]
                        : []),
                      ...(o.deliveryPartner ? [{ key: "partner", node: o.deliveryPartner }] : []),
                      ...(shippedAt
                        ? [{ key: "shipped", node: `Shipped ${new Date(shippedAt).toLocaleDateString("en-IN")}` }]
                        : []),
                      ...(deliveredAt
                        ? [{ key: "delivered", node: `Delivered ${new Date(deliveredAt).toLocaleDateString("en-IN")}` }]
                        : []),
                      ...(latest?.title ? [{ key: "latest", node: `Latest: ${latest.title}` }] : []),
                      ...(o.paymentStatus
                        ? [
                            {
                              key: "payment",
                              node: `Payment ${
                                o.codDelivery?.paymentPaid || o.paymentStatus === "Success" ? "Paid" : o.paymentStatus
                              }${
                                o.codDelivery?.collectionMethod
                                  ? ` · ${o.codDelivery.collectionMethod === "cash" ? "COD cash" : "COD UPI"}`
                                  : o.paymentMethod && /cod|cash on delivery/i.test(o.paymentMethod)
                                    ? ` · ${o.paymentMethod}`
                                    : ""
                              }`,
                            },
                          ]
                        : []),
                    ];
                    return (
                      <article key={o.id} className="account-order-card">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0">
                            <Link href={`/orders/${o.id}`} className="account-order-card__id">
                              {o.id}
                            </Link>
                            <div className="account-order-card__meta">
                              {metaBits.map((bit) => (
                                <span key={bit.key}>{bit.node}</span>
                              ))}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="account-order-card__total">{formatINR(o.total)}</p>
                            <span className={`account-order-card__status ${statusTone}`}>{o.status}</span>
                          </div>
                        </div>

                        {o.status === "Cancelled" ? (
                          <div className="account-order-steps">
                            <span className="account-order-step is-done">Cancelled</span>
                          </div>
                        ) : itemReturns.length > 0 || showReturnFlow ? (
                          <div className="mt-4">
                            {itemReturns.length > 0 ? (
                              <OrderTrackingCard order={o} returns={itemReturns} variant="plain" />
                            ) : (
                              <OrderReturnStatusBar order={o} />
                            )}
                          </div>
                        ) : step >= 0 ? (
                          <div className="account-order-steps" aria-label="Order progress">
                            {ORDER_FLOW.map((s, i) => (
                              <span key={s} className={`account-order-step ${i <= step ? "is-done" : ""}`}>
                                {s.replace("Pending Payment", "Payment")}
                              </span>
                            ))}
                          </div>
                        ) : null}

                        <div className="account-order-card__actions">
                          <Link href={`/orders/${o.id}`} className="btn-outline">
                            Track order
                          </Link>
                          {customerCanCancelOrder(o, user.email) && (
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `Cancel order ${o.id}? You can only do this before the order ships.`,
                                  )
                                ) {
                                  return;
                                }
                                void (async () => {
                                  const res = await fetchJson<Order>(`/api/account/orders/${encodeURIComponent(o.id)}`, {
                                    method: "POST",
                                    body: JSON.stringify({ reason: "Cancelled by customer" }),
                                  });
                                  if (res.ok && res.data) {
                                    mergeOrders([res.data]);
                                    toast("Order cancelled");
                                    return;
                                  }
                                  if (!res.ok && !isApiOffline(res)) {
                                    toast(res.error || "Could not cancel order.");
                                    return;
                                  }
                                  const err = customerCancelOrder(o.id, "Cancelled by customer");
                                  if (err) toast(err);
                                  else toast("Order cancelled");
                                })();
                              }}
                              className="btn-danger-ghost"
                            >
                              Cancel
                            </button>
                          )}
                          {customerCanRequestReturn(o, user.email) && (
                            <Link href={`/orders/${o.id}`} className="btn-outline">
                              Request return
                            </Link>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              for (const item of o.items) addToCart(item.productId, item.sku, item.quantity);
                              toast("Items added to bag");
                              router.push("/cart");
                            }}
                            className="btn-primary"
                          >
                            Buy again
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              downloadOrderInvoicePdf(o, {
                                customerName: name || user.name,
                                catalog,
                                store: ops?.settings,
                              })
                            }
                            className="btn-outline"
                          >
                            Download invoice
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {section === "addresses" && (
            <section>
              <h2 className="font-serif text-3xl tracking-tight">Addresses</h2>
              <p className="mt-2 text-sm text-ink-soft">
                Saved to your account and used automatically at checkout when you are signed in.
              </p>
              <div className="gold-line mt-4" />
              <div className="mt-6 space-y-3">
                {addressesLoading && (
                  <p className="text-sm text-ink-soft">Loading saved addresses…</p>
                )}
                {!addressesLoading && !addresses.length && (
                  <p className="text-sm text-ink-soft">No addresses yet. Add one below — or place an order and it will be saved here.</p>
                )}
                {addresses.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-start justify-between gap-3 border border-line bg-paper/50 p-4">
                    <div>
                      <p className="font-medium">
                        {a.name}
                        {a.isDefault && (
                          <span className="ml-2 text-[10px] tracking-widest uppercase text-gold-deep">Default</span>
                        )}
                      </p>
                      <p className="mt-1 text-sm text-ink-soft">
                        {a.line1}
                        {a.line2 ? `, ${a.line2}` : ""}
                        <br />
                        {a.city}, {a.state} {a.pincode}
                        <br />
                        {a.phone}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!a.isDefault && (
                        <button
                          type="button"
                          onClick={() => {
                            setDefaultAddress(a.id);
                            void persistAccountAddress({ ...a, isDefault: true }).then(() =>
                              toast("Default address updated"),
                            );
                          }}
                          className="text-[10px] tracking-widest uppercase text-ink-soft hover:text-ink"
                        >
                          Set default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startEdit(a)}
                        className="text-[10px] tracking-widest uppercase text-ink-soft hover:text-ink"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void deleteAccountAddress(a.id).then(() => toast("Address removed"));
                        }}
                        className="text-[10px] tracking-widest uppercase text-ink-soft hover:text-ink"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <form onSubmit={onSaveAddress} className="mt-8 max-w-lg space-y-3 border-t border-line pt-6">
                <p className="text-[11px] tracking-[0.16em] uppercase text-gold-deep">
                  {editingId ? "Edit address" : "Add address"}
                </p>
                <input
                  value={addrForm.name}
                  onChange={(e) => setAddrForm({ ...addrForm, name: e.target.value })}
                  placeholder="Full name"
                  className="w-full border border-line bg-transparent px-3 py-2 text-sm"
                />
                <input
                  type="tel"
                  value={addrForm.phone}
                  onChange={(e) => setAddrForm({ ...addrForm, phone: e.target.value })}
                  placeholder="Phone"
                  className="w-full border border-line bg-transparent px-3 py-2 text-sm"
                />
                <input
                  value={addrForm.line1}
                  onChange={(e) => setAddrForm({ ...addrForm, line1: e.target.value })}
                  placeholder="Address line"
                  className="w-full border border-line bg-transparent px-3 py-2 text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={addrForm.city}
                    onChange={(e) => setAddrForm({ ...addrForm, city: e.target.value })}
                    placeholder="City"
                    className="border border-line bg-transparent px-3 py-2 text-sm"
                  />
                  <input
                    value={addrForm.state}
                    onChange={(e) => setAddrForm({ ...addrForm, state: e.target.value })}
                    placeholder="State"
                    className="border border-line bg-transparent px-3 py-2 text-sm"
                  />
                </div>
                <input
                  value={addrForm.pincode}
                  onChange={(e) => setAddrForm({ ...addrForm, pincode: e.target.value })}
                  placeholder="PIN code"
                  className="w-full border border-line bg-transparent px-3 py-2 text-sm"
                />
                {addrMsg && <p className="text-xs text-ink-soft">{addrMsg}</p>}
                <div className="flex flex-wrap gap-3">
                  <button type="submit" className="btn-primary">
                    {editingId ? "Update address" : "Save address"}
                  </button>
                  {editingId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setAddrForm(emptyAddr);
                      }}
                      className="text-[11px] tracking-widest uppercase underline"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </section>
          )}

          {section === "wishlist" && (
            <section>
              <h2 className="font-serif text-3xl tracking-tight">Wishlist</h2>
              <div className="gold-line mt-4" />
              {!wishlist.length ? (
                <div className="mt-8">
                  <p className="text-sm text-ink-soft">No saved pieces yet.</p>
                  <Link href="/shop" className="btn-primary mt-6 inline-flex">
                    Browse jewellery
                  </Link>
                </div>
              ) : (
                <ul className="mt-6 space-y-4">
                  {wishlist.map(({ id, product }) => {
                    if (!product) {
                      return (
                        <li key={id} className="flex items-center justify-between border border-line px-4 py-3 text-sm">
                          <span className="text-ink-soft">This piece is no longer available.</span>
                          <button
                            type="button"
                            onClick={() => toggleWishlist(id)}
                            className="text-[10px] tracking-widest uppercase underline"
                          >
                            Remove
                          </button>
                        </li>
                      );
                    }
                    const price = displayPrice(product);
                    const variant = product.variants.find((v) => v.stock > 0) ?? product.variants[0];
                    const available = variant && variant.stock > 0;
                    return (
                      <li key={id} className="flex flex-wrap items-center gap-4 border border-line p-4">
                        <div className="relative h-20 w-16 overflow-hidden bg-ivory">
                          <ProductImage src={product.images[0]} alt={product.name} fill className="object-cover" sizes="64px" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <Link href={`/product/${product.slug}`} className="font-medium hover:text-gold-deep">
                            {product.name}
                          </Link>
                          <p className="mt-1 text-sm text-ink-soft">
                            {formatINR(price.from)}
                            {!available && <span className="ml-2 text-red-800">Unavailable</span>}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {available && (
                            <button
                              type="button"
                              onClick={() => {
                                addToCart(product.id, variant.sku, 1);
                                toast("Moved to bag");
                              }}
                              className="btn-primary py-2"
                            >
                              Move to bag
                            </button>
                          )}
                          {!available && (
                            <button
                              type="button"
                              onClick={() => {
                                const wasOn = (customer?.restockAlerts ?? []).includes(product.id);
                                useShopStore.getState().toggleRestockAlert(product.id);
                                toast(wasOn ? "Restock alert removed" : "Restock alert saved");
                              }}
                              className="border border-line px-3 py-2 text-[10px] tracking-widest uppercase"
                            >
                              {(customer?.restockAlerts ?? []).includes(product.id)
                                ? "Cancel alert"
                                : "Alert when back"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              toggleWishlist(id);
                              toast("Removed from wishlist");
                            }}
                            className="border border-line px-3 py-2 text-[10px] tracking-widest uppercase"
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Link href="/wishlist" className="mt-6 inline-block text-xs tracking-[0.16em] uppercase underline">
                Open full wishlist
              </Link>
            </section>
          )}

          {section === "visits" && (
            <section>
              <h2 className="font-serif text-3xl tracking-tight">Atelier visits</h2>
              <p className="mt-2 text-sm text-ink-soft">Viewings at 12 Walton Road booked with this email.</p>
              <div className="gold-line mt-4" />
              {!myVisits.length ? (
                <div className="mt-8">
                  <p className="text-sm text-ink-soft">No salon visits yet.</p>
                  <Link href="/visit" className="btn-primary mt-6 inline-flex">
                    Book a viewing
                  </Link>
                </div>
              ) : (
                <ul className="mt-6 space-y-3">
                  {myVisits.map((a) => (
                    <li key={a.id} className="border border-line px-4 py-4 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{formatVisitWhen(a.date, a.time)}</p>
                        <span className="text-ink-soft">{statusLabel(a.status)}</span>
                      </div>
                      <p className="mt-1 text-ink-soft">
                        {purposeLabel(a.purpose)} · {a.guests} guest{a.guests === 1 ? "" : "s"}
                      </p>
                      {isActiveAppointment(a.status) && (
                        <button
                          type="button"
                          className="mt-3 text-xs uppercase tracking-widest underline"
                          onClick={() => {
                            void cancelAppointment(a.id, user.email).then((err) => {
                              toast(err ?? "Visit cancelled");
                            });
                          }}
                        >
                          Cancel this hour
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/visit" className="mt-6 inline-block text-xs tracking-[0.16em] uppercase underline">
                Request another hour
              </Link>
            </section>
          )}

          {section === "certificates" && (
            <section>
              <h2 className="font-serif text-3xl tracking-tight">Certificates</h2>
              <p className="mt-2 text-sm text-ink-soft">Hallmark and gem certificates for your pieces.</p>
              <div className="gold-line mt-4" />
              {apiOffline && (
                <p className="mt-4 border border-line bg-ivory/70 px-4 py-3 text-sm text-ink-soft">
                  Certificate registry syncs when the database is online.
                </p>
              )}
              {!certificates.length ? (
                <p className="mt-6 text-sm text-ink-soft">No certificates on file for this account.</p>
              ) : (
                <ul className="mt-6 space-y-3">
                  {certificates.map((c) => (
                    <li key={c.id} className="border border-line px-4 py-3 text-sm">
                      <p className="font-medium">{c.number}</p>
                      <p className="mt-1 text-ink-soft">
                        {c.type}
                        {c.product?.name ? ` · ${c.product.name}` : ""}
                      </p>
                      {c.issueDate && (
                        <p className="mt-1 text-xs text-ink-soft">
                          Issued {new Date(c.issueDate).toLocaleDateString("en-IN")}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {section === "repairs" && (
            <section>
              <h2 className="font-serif text-3xl tracking-tight">Repairs</h2>
              <p className="mt-2 text-sm text-ink-soft">Resize, polish, and repair requests.</p>
              <div className="gold-line mt-4" />
              {apiOffline && (
                <p className="mt-4 border border-line bg-ivory/70 px-4 py-3 text-sm text-ink-soft">
                  Repair history syncs when the database is online.
                </p>
              )}
              {!repairs.length ? (
                <p className="mt-6 text-sm text-ink-soft">No repair requests yet.</p>
              ) : (
                <ul className="mt-6 space-y-3">
                  {repairs.map((r) => (
                    <li key={r.id} className="border border-line px-4 py-3 text-sm">
                      <div className="flex flex-wrap justify-between gap-2">
                        <p className="font-medium">{r.productName || "Piece"}</p>
                        <span className="text-ink-soft">{r.status}</span>
                      </div>
                      <p className="mt-1 text-xs text-ink-soft">
                        {r.type} · {new Date(r.createdAt).toLocaleString("en-IN")}
                      </p>
                      <p className="mt-2 text-ink-soft">{r.description}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {section === "loyalty" && (
            <section>
              <h2 className="font-serif text-3xl tracking-tight">Loyalty</h2>
              <p className="mt-2 text-sm text-ink-soft">Points balance and recent activity.</p>
              <div className="gold-line mt-4" />
              {apiOffline && (
                <p className="mt-4 border border-line bg-ivory/70 px-4 py-3 text-sm text-ink-soft">
                  Loyalty ledger syncs when the database is online.
                </p>
              )}
              {loyalty ? (
                <>
                  <div className="mt-6 border border-line bg-paper/50 p-5">
                    <p className="text-[11px] tracking-widest uppercase text-gold-deep">Balance</p>
                    <p className="mt-2 font-serif text-3xl">{loyalty.balance} pts</p>
                    {loyalty.tier && <p className="mt-1 text-sm text-ink-soft">Tier: {loyalty.tier}</p>}
                  </div>
                  {loyalty.transactions?.length ? (
                    <ul className="mt-6 space-y-2 text-sm">
                      {loyalty.transactions.map((tx) => (
                        <li key={tx.id} className="flex justify-between border border-line px-4 py-2">
                          <span className="text-ink-soft">{tx.type}</span>
                          <span>
                            {tx.amount > 0 ? "+" : ""}
                            {tx.amount} · {new Date(tx.createdAt).toLocaleDateString("en-IN")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-6 text-sm text-ink-soft">No transactions yet.</p>
                  )}
                </>
              ) : (
                <p className="mt-6 text-sm text-ink-soft">Loyalty balance will appear when connected.</p>
              )}
            </section>
          )}

          {section === "referrals" && (
            <section>
              <h2 className="font-serif text-3xl tracking-tight">Referrals</h2>
              <p className="mt-2 text-sm text-ink-soft">Share Avyora with friends and track invitations.</p>
              <div className="gold-line mt-4" />
              {apiOffline && (
                <p className="mt-4 border border-line bg-ivory/70 px-4 py-3 text-sm text-ink-soft">
                  Referral data syncs when the database is online.
                </p>
              )}
              {referrals?.code ? (
                <>
                  <div className="mt-6 border border-line bg-ivory/70 px-4 py-3 text-sm">
                    <p className="text-[11px] tracking-widest uppercase text-gold-deep">Your code</p>
                    <p className="mt-2 font-medium">{referrals.code}</p>
                    <p className="mt-2 text-xs text-ink-soft">Share link: /register?ref={referrals.code}</p>
                  </div>
                  {referrals.referrals?.length ? (
                    <ul className="mt-6 space-y-2 text-sm">
                      {referrals.referrals.map((ref) => (
                        <li key={ref.id} className="border border-line px-4 py-2">
                          {ref.referred?.user?.name ?? ref.referred?.user?.email ?? "Invited client"} ·{" "}
                          {new Date(ref.createdAt).toLocaleDateString("en-IN")}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-6 text-sm text-ink-soft">No referrals recorded yet.</p>
                  )}
                </>
              ) : (
                <p className="mt-6 text-sm text-ink-soft">Your referral code will appear when connected.</p>
              )}
            </section>
          )}

          {section === "ring-size" && (
            <section className="max-w-md">
              <h2 className="font-serif text-3xl tracking-tight">Ring size</h2>
              <p className="mt-2 text-sm text-ink-soft">
                Measure finger circumference or save your preferred India size for shopping.
              </p>
              <div className="gold-line mt-4" />
              <label className="mt-6 block text-sm">
                Preferred ring size (India)
                <select
                  value={customer?.preferredRingSize ?? ""}
                  onChange={(e) => {
                    useShopStore.getState().setPreferredRingSize(e.target.value);
                    toast("Ring size saved");
                  }}
                  className="mt-1 w-full border border-line bg-transparent px-3 py-2.5"
                >
                  <option value="">Select size</option>
                  {Array.from({ length: 15 }, (_, i) => String(i + 6)).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setRingMsg("");
                  setRingResult(null);
                  const mm = Number(ringCircumference);
                  if (!mm || mm <= 0) {
                    setRingMsg("Enter a valid circumference in millimetres.");
                    return;
                  }
                  const res = await fetchJson<{
                    recommendedIndiaSize?: string;
                    conversions?: Record<string, string | null>;
                  }>("/api/tools/ring-size", {
                    method: "POST",
                    body: JSON.stringify({ circumferenceMm: mm }),
                  });
                  if (isApiOffline(res)) {
                    setRingMsg("Size recommendations sync when the database is online.");
                    return;
                  }
                  if (!res.ok) {
                    setRingMsg(res.error);
                    return;
                  }
                  setRingResult(res.data ?? null);
                  if (res.data?.recommendedIndiaSize) {
                    useShopStore.getState().setPreferredRingSize(res.data.recommendedIndiaSize);
                    toast("Recommended size saved");
                  }
                }}
                className="mt-8 space-y-3 border-t border-line pt-6"
              >
                <p className="text-[11px] tracking-[0.16em] uppercase text-gold-deep">Find your size</p>
                <input
                  type="number"
                  step="0.1"
                  min="40"
                  max="80"
                  value={ringCircumference}
                  onChange={(e) => setRingCircumference(e.target.value)}
                  placeholder="Finger circumference (mm)"
                  className="w-full border border-line bg-transparent px-3 py-2 text-sm"
                />
                {ringMsg && <p className="text-xs text-ink-soft">{ringMsg}</p>}
                {ringResult?.recommendedIndiaSize && (
                  <p className="text-sm text-ink">
                    Recommended India size: <span className="font-medium">{ringResult.recommendedIndiaSize}</span>
                    {ringResult.conversions?.us ? ` · US ${ringResult.conversions.us}` : ""}
                  </p>
                )}
                <button type="submit" className="btn-primary">
                  Recommend size
                </button>
              </form>
            </section>
          )}

          {section === "returns" && (
            <section>
              <h2 className="font-serif text-3xl tracking-tight">Returns & refunds</h2>
              <p className="mt-2 text-sm text-ink-soft">
                Request a return from a delivered order within 15 days of delivery. Track pickup,
                inspection, and refund status for each product.
              </p>
              <div className="gold-line mt-4" />
              {!accountReturns.length ? (
                <p className="mt-6 text-sm text-ink-soft">
                  No return or refund activity yet. Open a delivered order and choose Request return.
                </p>
              ) : (
                <ul className="mt-6 space-y-6">
                  {accountReturns.map((r) => (
                    <li key={r.id} className="border border-line bg-paper/40 px-4 py-4 text-sm">
                      <div className="flex flex-wrap justify-between gap-2">
                        <Link
                          href={`/orders/${r.orderId}`}
                          className="font-medium hover:text-gold-deep"
                        >
                          {r.returnNumber}
                        </Link>
                        <span>{r.statusLabel}</span>
                      </div>
                      <p className="mt-2 text-ink-soft">
                        {r.item.name} · {r.item.sku} · Qty {r.quantity}
                      </p>
                      <p className="mt-1 text-ink-soft">Reason: {r.reason}</p>
                      <div className="mt-4">
                        <ReturnTrackingTimeline ret={r} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {section === "security" && (
            <section className="max-w-md">
              <h2 className="font-serif text-3xl tracking-tight">Security</h2>
              <p className="mt-2 text-sm text-ink-soft">Change your password. Passwords are never shown in plain text.</p>
              <div className="gold-line mt-4" />
              <form onSubmit={onChangePassword} className="mt-6 space-y-4">
                <label className="block text-sm">
                  Current password
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    required
                    className="mt-1 w-full border border-line bg-transparent px-3 py-2.5"
                  />
                </label>
                <label className="block text-sm">
                  New password
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    required
                    minLength={8}
                    className="mt-1 w-full border border-line bg-transparent px-3 py-2.5"
                  />
                </label>
                <label className="block text-sm">
                  Confirm new password
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    required
                    minLength={8}
                    className="mt-1 w-full border border-line bg-transparent px-3 py-2.5"
                  />
                </label>
                <p className="text-xs text-ink-soft">At least 8 characters with a letter and a number.</p>
                {securityErr && <p className="text-sm text-red-800">{securityErr}</p>}
                {securityMsg && <p className="text-sm text-ink-soft">{securityMsg}</p>}
                <button type="submit" className="btn-primary">
                  Update password
                </button>
              </form>
            </section>
          )}

          {section === "notifications" && (
            <section className="max-w-md">
              <h2 className="font-serif text-3xl tracking-tight">Notifications</h2>
              <p className="mt-2 text-sm text-ink-soft">Choose which messages you receive.</p>
              <div className="gold-line mt-4" />
              <div className="mt-6 space-y-4 text-sm">
                {(
                  [
                    ["orders", "Order updates"],
                    ["security", "Security alerts"],
                    ["marketing", "Offers & atelier news"],
                  ] as const
                ).map(([key, label]) => {
                  const checked =
                    key === "orders"
                      ? customer?.notifications?.orders ?? true
                      : key === "security"
                        ? customer?.notifications?.security ?? true
                        : customer?.notifications?.marketing ?? false;
                  return (
                    <label key={key} className="flex items-center justify-between gap-4 border border-line px-4 py-3">
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          updateNotifications({ [key]: e.target.checked });
                          toast("Preferences saved");
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-16 text-sm text-ink-soft">Loading account…</div>}>
      <AccountInner />
    </Suspense>
  );
}
