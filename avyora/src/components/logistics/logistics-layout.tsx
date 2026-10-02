"use client";

import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/cn";
import { LOGISTICS_ORIGIN, STOREFRONT_ORIGIN } from "@/lib/host";
import { ensureStaffSession, logoutStaff } from "@/lib/staff-auth";
import { hasLogisticsAccess, isDispatchOnly } from "@/lib/staff-permissions";
import { useShopStore } from "@/store/shop-store";
import { fetchLogisticsOrders } from "@/lib/logistics-api";
import {
  ClipboardList,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Truck,
  Undo2,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

const warehouseNav = [
  { href: "/logistics", label: "Dashboard", icon: LayoutDashboard },
  { href: "/logistics/orders", label: "Orders", icon: ClipboardList },
  { href: "/logistics/dispatch", label: "Local dispatch", icon: Truck },
  { href: "/logistics/returns", label: "Returns", icon: Undo2 },
  { href: "/logistics/pack", label: "Packing", icon: Package },
  { href: "/logistics/manifest", label: "Manifest", icon: FileSpreadsheet },
];

const partnerNav = [{ href: "/logistics/dispatch", label: "Local dispatch", icon: Truck }];

function OrderScan() {
  const router = useRouter();
  const orders = useShopStore((s) => s.orders);
  const [value, setValue] = useState("");
  const [miss, setMiss] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    const q = raw.toLowerCase();
    const match = orders.find(
      (order) =>
        order.id.toLowerCase() === q ||
        order.trackingId?.toLowerCase() === q ||
        order.shipmentId?.toLowerCase() === q,
    );
    if (match) {
      setMiss("");
      setValue("");
      router.push(`/logistics/orders/${match.id}`);
      return;
    }
    setMiss("No exact order, AWB, or shipment id. Showing search results.");
    router.push(`/logistics/orders?q=${encodeURIComponent(raw)}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label className="min-w-0 flex-1 text-sm">
        <span className="sr-only">Scan or type an order, AWB, or shipment id</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Scan order, AWB, or shipment id"
          className="w-full border border-line bg-transparent px-3 py-2"
        />
      </label>
      <button type="submit" className="min-h-11 border border-line px-4 py-2 text-[11px] uppercase tracking-widest sm:min-w-24">
        Open
      </button>
      {miss ? <p className="w-full text-xs text-ink-soft">{miss}</p> : null}
    </form>
  );
}

export { hasLogisticsAccess } from "@/lib/staff-permissions";

export function LogisticsLayout({ children }: { children: React.ReactNode }) {
  const user = useShopStore((s) => s.user);
  const hydrated = useShopStore((s) => s.hydrated);
  const ops = useShopStore((s) => s.ops);
  const pathname = usePathname();
  const router = useRouter();
  const [jwtOk, setJwtOk] = useState<boolean | null>(null);
  const [sessionPermissions, setSessionPermissions] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  const account = ops?.adminUsers.find((a) => a.email.toLowerCase() === user?.email.toLowerCase());
  const rosterAllowed = hasLogisticsAccess(account?.permissions);
  const jwtAllowed = hasLogisticsAccess(sessionPermissions);
  const partnerOnly =
    isDispatchOnly(sessionPermissions) ||
    (!jwtAllowed && isDispatchOnly(account?.permissions));
  const hasAccess =
    user?.role === "admin" &&
    jwtOk === true &&
    (jwtAllowed || (account?.active && rosterAllowed));
  const navItems = useMemo(() => (partnerOnly ? partnerNav : warehouseNav), [partnerOnly]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await ensureStaffSession();
      if (cancelled) return;
      if (!session) {
        setJwtOk(false);
        setSessionPermissions([]);
        return;
      }
      setSessionPermissions(session.permissions);
      setJwtOk(true);
      const roster = useShopStore.getState().ops?.adminUsers.find(
        (a) => a.email.toLowerCase() === session.email.toLowerCase(),
      );
      useShopStore.getState().setStaffSession({
        id: roster?.id ?? session.userId,
        name: roster?.name ?? session.email.split("@")[0] ?? "Staff",
        email: session.email,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (jwtOk !== true || partnerOnly) return;
    let cancelled = false;
    void fetchLogisticsOrders({ pageSize: 100 }).then((res) => {
      if (cancelled || !res.ok || !res.data?.orders?.length) return;
      useShopStore.getState().mergeOrders(res.data.orders);
    });
    return () => {
      cancelled = true;
    };
  }, [jwtOk, partnerOnly]);

  useEffect(() => {
    if (!hydrated || jwtOk === null) return;
    // Never revoke refresh tokens on a failed probe — redirect only.
    if (jwtOk === false) {
      router.replace("/logistics-login");
      return;
    }
    if (account && !account.active) {
      void logoutStaff().then(() => {
        router.replace("/logistics-login");
      });
      return;
    }
    if (
      partnerOnly &&
      !pathname.startsWith("/logistics/dispatch") &&
      !pathname.startsWith("/logistics/delivery")
    ) {
      router.replace("/logistics/dispatch");
    }
  }, [hydrated, jwtOk, account, router, partnerOnly, pathname]);

  if (!hydrated || jwtOk === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#14110e] text-sm text-ivory/70">
        Checking logistics access…
      </div>
    );
  }

  if (jwtOk === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#14110e] text-sm text-ivory/70">
        <p>Redirecting to logistics sign in…</p>
        <Link href="/logistics-login" className="text-ivory underline">
          Continue to logistics login
        </Link>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#14110e] px-6 text-center text-sm text-ivory/70">
        <p>Your staff account does not have logistics access.</p>
        <button
          type="button"
          className="text-ivory underline"
          onClick={() => {
            void logoutStaff().then(() => router.replace("/logistics-login"));
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="logistics-shell flex min-h-screen bg-[#f7f3eb] text-ink">
      {menuOpen ? (
        <button
          type="button"
          className="logistics-no-print fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
      <aside
        className={cn(
          "logistics-no-print fixed inset-y-0 left-0 z-50 w-[min(18rem,88vw)] flex-col overflow-y-auto border-r border-white/5 bg-[#12100e] text-ivory md:sticky md:top-0 md:z-auto md:flex md:h-screen md:w-56 md:shrink-0 lg:w-64 xl:w-72",
          menuOpen ? "flex" : "hidden md:flex",
        )}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-6 md:py-7">
          <div className="min-w-0">
            <BrandLogo
              href={partnerOnly ? "/logistics/dispatch" : "/logistics"}
              inverted
              caption={partnerOnly ? "Local dispatch" : "Logistics"}
              size="lg"
            />
            <p className="mt-3 text-[11px] text-ivory/45">
              {partnerOnly ? "Delivery partner" : account?.role ?? "Staff"}
            </p>
          </div>
          <button
            type="button"
            className="mt-1 inline-flex h-11 w-11 items-center justify-center text-ivory md:hidden"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {navItems.map((item) => {
            const active = pathname === item.href || (item.href !== "/logistics" && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                  active ? "bg-white/10 text-ivory" : "text-ivory/55 hover:bg-white/5 hover:text-ivory",
                )}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-xs text-ivory/45">
          <p className="truncate text-ivory/70">{user?.email}</p>
          <p className="mt-1">
            {partnerOnly ? "Partner dispatch" : "Logistics portal"} ·{" "}
            {LOGISTICS_ORIGIN.replace(/^https?:\/\//, "")}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <a href={STOREFRONT_ORIGIN} className="underline hover:text-ivory">
              View store
            </a>
            <button
              type="button"
              className="inline-flex items-center gap-1 underline hover:text-ivory"
              onClick={() => {
                void logoutStaff().then(() => router.replace("/logistics-login"));
              }}
            >
              <LogOut size={12} /> Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="logistics-no-print sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-white/10 bg-[#12100e] px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 text-ivory md:hidden">
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={20} />
          </button>
          <BrandLogo
            href={partnerOnly ? "/logistics/dispatch" : "/logistics"}
            inverted
            caption={partnerOnly ? "Dispatch" : "Logistics"}
            size="sm"
          />
          <button
            type="button"
            className="inline-flex h-11 items-center gap-1 px-2 text-[11px] uppercase tracking-widest"
            onClick={() => {
              void logoutStaff().then(() => router.replace("/logistics-login"));
            }}
          >
            <LogOut size={14} /> Out
          </button>
        </div>
        {!partnerOnly ? (
          <div className="logistics-no-print border-b border-line bg-paper/80 px-4 py-3 md:px-6 lg:px-8">
            <OrderScan />
          </div>
        ) : null}
        <main className="min-w-0 flex-1 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:px-6 md:py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
