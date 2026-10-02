"use client";

import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/cn";
import { STOREFRONT_ORIGIN } from "@/lib/host";
import { ensureStaffSession, logoutStaff } from "@/lib/staff-auth";
import { useShopStore } from "@/store/shop-store";
import {
  Award,
  BarChart3,
  Bell,
  CalendarClock,
  ClipboardList,
  CreditCard,
  FolderOpen,
  Gem,
  Gift,
  ImageIcon,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Package,
  PackageOpen,
  Percent,
  ScrollText,
  Search,
  Settings,
  Shield,
  ShoppingBag,
  Sparkles,
  Star,
  Store,
  Tag,
  TrendingUp,
  Truck,
  Undo2,
  Users,
  Warehouse,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const groups = [
  {
    label: "Overview",
    items: [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard, perm: "*" },
      { href: "/admin/reports", label: "Reports", icon: BarChart3, perm: "reports" },
      { href: "/admin/recommendations", label: "Recommendations", icon: Sparkles, perm: "reports" },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/admin/products", label: "Products", icon: Package, perm: "products" },
      { href: "/admin/categories", label: "Categories", icon: Tag, perm: "categories" },
      { href: "/admin/brands", label: "Brands", icon: Store, perm: "categories" },
      { href: "/admin/attributes", label: "Attributes", icon: ClipboardList, perm: "products" },
      { href: "/admin/inventory", label: "Inventory", icon: Warehouse, perm: "inventory" },
      { href: "/admin/consignments", label: "Consignments", icon: PackageOpen, perm: "inventory" },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/admin/orders", label: "Orders", icon: ShoppingBag, perm: "orders" },
      { href: "/admin/payments", label: "Payments", icon: CreditCard, perm: "orders" },
      { href: "/admin/returns", label: "Returns & refunds", icon: Undo2, perm: "returns" },
      { href: "/admin/shipping", label: "Shipping", icon: Truck, perm: "shipping" },
      { href: "/admin/repairs", label: "Repairs", icon: Wrench, perm: "orders" },
      { href: "/admin/certificates", label: "Certificates", icon: Award, perm: "orders" },
      { href: "/admin/bespoke", label: "Bespoke", icon: Gem, perm: "orders" },
    ],
  },
  {
    label: "Customers",
    items: [
      { href: "/admin/customers", label: "Customers", icon: Users, perm: "customers" },
      { href: "/admin/appointments", label: "Atelier visits", icon: CalendarClock, perm: "customers" },
      { href: "/admin/groups", label: "Customer groups", icon: Users, perm: "customers" },
      { href: "/admin/loyalty", label: "Loyalty", icon: Gift, perm: "admin_only" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/admin/coupons", label: "Coupons", icon: Percent, perm: "admin_only" },
      { href: "/admin/campaigns", label: "Promotions", icon: Megaphone, perm: "admin_only" },
      { href: "/admin/reviews", label: "Reviews", icon: Star, perm: "products" },
      { href: "/admin/search", label: "Search insights", icon: Search, perm: "admin_only" },
    ],
  },
  {
    label: "Website",
    items: [
      { href: "/admin/homepage", label: "Homepage", icon: LayoutDashboard, perm: "admin_only" },
      { href: "/admin/banners", label: "Banners", icon: ImageIcon, perm: "admin_only" },
      { href: "/admin/pages", label: "Pages", icon: FolderOpen, perm: "admin_only" },
      { href: "/admin/menus", label: "Menus", icon: Menu, perm: "admin_only" },
      { href: "/admin/media", label: "Media", icon: ImageIcon, perm: "admin_only" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/admin/gold-rates", label: "Gold rates", icon: TrendingUp, perm: "admin_only" },
      { href: "/admin/notifications", label: "Notifications", icon: Bell, perm: "admin_only" },
      { href: "/admin/settings", label: "Settings", icon: Settings, perm: "admin_only" },
      { href: "/admin/users", label: "Admin users", icon: Shield, perm: "admin_only" },
      { href: "/admin/audit", label: "Activity history", icon: ScrollText, perm: "admin_only" },
    ],
  },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = useShopStore((s) => s.user);
  const hydrated = useShopStore((s) => s.hydrated);
  const ops = useShopStore((s) => s.ops);
  const router = useRouter();
  const pathname = usePathname();
  const settings = ops?.settings;
  const account = ops?.adminUsers.find((a) => a.email.toLowerCase() === user?.email.toLowerCase());
  const [jwtOk, setJwtOk] = useState<boolean | null>(null);

  // Verify staff JWT once per mount — NOT on every route change (that raced refresh rotation → login loop).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await ensureStaffSession();
      if (cancelled) return;
      if (!session) {
        setJwtOk(false);
        return;
      }
      const roster = useShopStore.getState().ops?.adminUsers.find(
        (a) => a.email.toLowerCase() === session.email.toLowerCase(),
      );
      useShopStore.getState().setStaffSession({
        id: roster?.id ?? session.userId,
        name: roster?.name ?? session.email.split("@")[0] ?? "Admin",
        email: session.email,
      });
      setJwtOk(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || jwtOk === null) return;
    // Never call logoutStaff() on a failed probe — that deletes refresh tokens and
    // turns a transient network/refresh race into a permanent forced sign-out.
    if (jwtOk === false) {
      router.replace("/staff-login");
      return;
    }
    if (account && !account.active) {
      void logoutStaff().then(() => router.replace("/staff-login"));
    }
  }, [hydrated, router, account, jwtOk]);

  if (!hydrated || jwtOk === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#14110e] text-sm text-ivory/70">
        Checking admin access…
      </div>
    );
  }

  if (jwtOk === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#14110e] text-sm text-ivory/70">
        <p>Redirecting to staff sign in…</p>
        <Link href="/staff-login" className="text-ivory underline">
          Continue to staff login
        </Link>
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#14110e] text-sm text-ivory/70">
        Restoring admin session…
      </div>
    );
  }

  function allowed(perm: string) {
    if (!account) return true;
    if (account.permissions.includes("*")) return true;
    if (perm === "*") return true;
    if (perm === "admin_only") return false;
    return account.permissions.includes(perm);
  }

  return (
    <div className="flex min-h-screen bg-[#f7f3eb] text-ink">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-white/5 bg-[#12100e] text-ivory lg:flex">
        <div className="px-5 py-7">
          <BrandLogo href="/admin" inverted caption="Admin" size="lg" />
          <p className="mt-3 text-[11px] text-ivory/45">{account?.role ?? "Administrator"}</p>
        </div>
        <nav className="flex-1 space-y-5 px-3 pb-6">
          {groups.map((group) => {
            const items = group.items.filter((i) => allowed(i.perm));
            if (!items.length) return null;
            return (
              <div key={group.label}>
                <p className="px-3 pb-2 text-[10px] tracking-[0.18em] uppercase text-ivory/35">{group.label}</p>
                {items.map((item) => {
                  const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 border-l-2 px-3 py-2 text-sm transition",
                        active
                          ? "border-[#c4a574] bg-ivory/[0.07] text-ivory"
                          : "border-transparent text-ivory/55 hover:bg-ivory/[0.04] hover:text-ivory",
                      )}
                    >
                      <Icon size={15} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-4 text-sm">
          <p className="truncate text-ivory/70">{user.email}</p>
          <div className="mt-3 flex flex-col gap-2">
            <a href={STOREFRONT_ORIGIN} className="flex items-center gap-2 text-ivory/55 transition hover:text-ivory">
              <Store size={14} /> View store
            </a>
            <button
              onClick={() => {
                void logoutStaff().then(() => router.replace("/staff-login"));
              }}
              className="flex items-center gap-2 text-left text-ivory/55 transition hover:text-ivory"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {settings?.maintenance && (
          <div className="bg-ink px-4 py-2 text-center text-xs tracking-widest uppercase text-ivory">
            Maintenance mode is on — storefront should show a pause state
          </div>
        )}
        <div className="px-4 py-9 lg:px-8">{children}</div>
      </div>
    </div>
  );
}
