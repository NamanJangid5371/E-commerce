"use client";

import { BrandLogo } from "@/components/brand-logo";
import { getCategoryNavIcon, type CategoryNavIconProps } from "@/components/category-nav-icons";
import { cn } from "@/lib/cn";
import { isAdminHost, isLogisticsHost } from "@/lib/host";
import { useShopStore } from "@/store/shop-store";
import type { ComponentType } from "react";
import { Heart, Search, ShoppingBag, Store, User } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

type NavItem = {
  href: string;
  label: string;
  key: string;
  icon: ComponentType<CategoryNavIconProps>;
};

function isNavActive(href: string, pathname: string, categoryParam: string | null) {
  if (href === "/shop") return pathname === "/shop" && !categoryParam;
  if (href.startsWith("/shop?category=")) {
    const cat = decodeURIComponent(href.split("category=")[1] ?? "");
    return pathname === "/shop" && categoryParam === cat;
  }
  if (href === "/about") return pathname === "/about" || pathname.startsWith("/care") || pathname.startsWith("/faq");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function CategoryNavLink({
  item,
  pathname,
  categoryParam,
}: {
  item: NavItem;
  pathname: string;
  categoryParam: string | null;
}) {
  const active = isNavActive(item.href, pathname, categoryParam);
  const Icon = item.icon;

  return (
    <Link href={item.href} className={cn("luxury-header__category-link", active && "is-active")}>
      <span className="luxury-header__category-icon">
        <Icon size={26} />
      </span>
      <span className="luxury-header__category-label">{item.label}</span>
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get("category");
  const router = useRouter();
  const cart = useShopStore((s) => s.cart);
  const wishlist = useShopStore((s) => s.wishlist);
  const user = useShopStore((s) => s.user);
  const hydrated = useShopStore((s) => s.hydrated);
  const accountHref = !hydrated || user ? "/account" : "/login";
  const ops = useShopStore((s) => s.ops);
  const collections = useShopStore((s) => s.collections);
  const settings = ops?.settings;
  const [search, setSearch] = useState("");
  const [adminHost, setAdminHost] = useState(() => process.env.NEXT_PUBLIC_AVYORA_APP === "admin");
  const [logisticsHost, setLogisticsHost] = useState(() => process.env.NEXT_PUBLIC_AVYORA_APP === "logistics");
  const [categoriesCollapsed, setCategoriesCollapsed] = useState(true);
  const count = cart.reduce((n, i) => n + i.quantity, 0);

  const categoryNavItems = useMemo(() => {
    const items: NavItem[] = [
      { href: "/shop", label: "Shop", key: "shop-all", icon: getCategoryNavIcon("Shop", "/shop") },
    ];

    for (const category of [...(ops?.categories ?? [])].filter((c) => c.enabled && c.showInMenu).sort((a, b) => a.order - b.order)) {
      const href = `/shop?category=${encodeURIComponent(category.name)}`;
      items.push({
        href,
        label: category.name,
        key: category.id,
        icon: getCategoryNavIcon(category.name, href),
      });
    }

    for (const collection of collections) {
      const href = `/collections/${collection.slug}`;
      items.push({
        href,
        label: collection.name,
        key: `collection-${collection.slug}`,
        icon: getCategoryNavIcon(collection.name, href),
      });
    }

    items.push({ href: "/about", label: "Maison", key: "maison", icon: getCategoryNavIcon("Maison", "/about") });
    return items;
  }, [ops?.categories, collections]);

  useEffect(() => {
    setAdminHost(isAdminHost());
    setLogisticsHost(isLogisticsHost());
  }, []);

  useEffect(() => {
    let frame = 0;
    let lockTimer = 0;
    let locked = false;
    let collapsed = true;

    function collapseLine() {
      const track = document.querySelector(".luxury-header__categories-track");
      const categories = track?.scrollHeight ?? 120;
      const expandedBar = window.matchMedia("(min-width: 768px)").matches ? 104 : 92;
      return expandedBar + categories;
    }

    function apply() {
      const hero = document.querySelector(".luxury-hero");
      let next = true;
      if (hero) {
        const bottom = hero.getBoundingClientRect().bottom;
        const line = collapseLine();
        // Gap is wider than the header's own height change, so collapsing
        // the bar cannot immediately open it again.
        next = collapsed ? bottom < line + 96 : bottom <= line;
      }
      if (next === collapsed) return;
      collapsed = next;
      setCategoriesCollapsed(next);
      locked = true;
      window.clearTimeout(lockTimer);
      lockTimer = window.setTimeout(() => {
        locked = false;
        apply();
      }, 480);
    }

    function onScroll() {
      if (locked) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(apply);
    }

    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(lockTimer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pathname]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
    setSearch("");
  }

  if (
    adminHost ||
    logisticsHost ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/staff-login") ||
    pathname.startsWith("/logistics") ||
    pathname.startsWith("/logistics-login")
  )
    return null;

  return (
    <header className={cn("luxury-header", categoriesCollapsed && "is-categories-collapsed")}>
      {settings?.maintenance ? (
        <div className="bg-secondary px-4 py-2 text-center text-[10px] tracking-[0.18em] text-primary uppercase">
          Site maintenance — checkout paused
        </div>
      ) : null}

      <div className="luxury-header__inner w-full px-4 lg:px-8">
        <div className="luxury-header__bar">
          <div className="luxury-header__start">
            <BrandLogo href="/" size="header" className="shrink-0" />
          </div>

          <form onSubmit={onSearch} className="luxury-header__search">
            <Search size={18} className="luxury-header__search-icon shrink-0" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search for rings, necklaces & more"
              aria-label="Search jewellery"
              className="luxury-header__search-input"
            />
          </form>

          <div className="luxury-header__actions">
            <Link href="/visit" className="luxury-header__icon" aria-label="Book a private viewing">
              <Store size={22} strokeWidth={1.75} />
            </Link>
            <Link href="/wishlist" className="luxury-header__icon relative" aria-label="Wishlist">
              <Heart size={22} strokeWidth={1.75} />
              {wishlist.length > 0 && <span className="luxury-header__badge">{wishlist.length}</span>}
            </Link>
            <Link
              href={accountHref}
              className="luxury-header__account"
              aria-label={user?.role === "customer" ? `Account — ${user.name}` : "Sign in"}
            >
              <span className="luxury-header__account-icon" aria-hidden>
                <User size={16} strokeWidth={1.75} />
              </span>
              <span className="luxury-header__account-copy">
                <span className="luxury-header__account-kicker">
                  {user?.role === "customer" ? "Account" : "Welcome"}
                </span>
                <span className="luxury-header__account-name">
                  {user?.role === "customer" ? user.name.split(" ")[0] : "Sign in"}
                </span>
              </span>
            </Link>
            <Link href="/cart" className="luxury-header__icon relative" aria-label="Bag">
              <ShoppingBag size={22} strokeWidth={1.75} />
              {count > 0 && <span className="luxury-header__badge">{count}</span>}
            </Link>
          </div>
        </div>

        <nav
          className="luxury-header__categories"
          aria-label="Categories"
          aria-hidden={categoriesCollapsed}
        >
          <div className="luxury-header__categories-track">
            {categoryNavItems.map((item) => (
              <CategoryNavLink key={item.key} item={item} pathname={pathname} categoryParam={categoryParam} />
            ))}
          </div>
        </nav>
      </div>
    </header>
  );
}
