"use client";

import { BrandLogo } from "@/components/brand-logo";
import { site } from "@/data/content";
import { isAdminHost, isLogisticsHost } from "@/lib/host";
import { useShopStore } from "@/store/shop-store";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function SiteFooter() {
  const pathname = usePathname();
  const ops = useShopStore((s) => s.ops);
  const settings = ops?.settings;
  const footerLinks = (ops?.menus ?? [])
    .filter((m) => m.location === "footer" && m.enabled)
    .sort((a, b) => a.order - b.order);
  const [adminHost, setAdminHost] = useState(() => process.env.NEXT_PUBLIC_AVYORA_APP === "admin");
  const [logisticsHost, setLogisticsHost] = useState(() => process.env.NEXT_PUBLIC_AVYORA_APP === "logistics");
  const [year] = useState(() => new Date().getFullYear());

  useEffect(() => {
    setAdminHost(isAdminHost());
    setLogisticsHost(isLogisticsHost());
  }, []);

  if (
    adminHost ||
    logisticsHost ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/account") ||
    pathname.startsWith("/staff-login") ||
    pathname.startsWith("/logistics") ||
    pathname.startsWith("/logistics-login")
  )
    return null;

  return (
    <footer className="luxury-footer mt-auto">
      <div className="mx-auto max-w-7xl px-4 py-8 md:py-10 lg:px-6">
        <div className="grid gap-8 md:grid-cols-12 md:gap-6">
          <div className="md:col-span-5">
            <BrandLogo href="/" size="sm" />
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-[rgba(250,246,238,0.72)]">
              {settings?.tagline ?? site.tagline} Hallmarked pieces from our Bengaluru atelier — crafted for everyday
              elegance and occasion.
            </p>
            <Link href="/visit" className="btn-ghost mt-4 inline-flex border-secondary/40">
              Book a private viewing
            </Link>
          </div>

          <div className="grid gap-6 sm:grid-cols-3 md:col-span-7">
            <div>
              <p className="luxury-footer__heading">Maison</p>
              <div className="mt-2.5 flex flex-col gap-1.5">
                {footerLinks.slice(0, 4).map((l) => (
                  <Link key={l.id} href={l.href} className="luxury-footer__link">
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <p className="luxury-footer__heading">Client care</p>
              <div className="mt-2.5 flex flex-col gap-1.5">
                <Link href="/track" className="luxury-footer__link">
                  Track order
                </Link>
                {footerLinks.slice(4).map((l) => (
                  <Link key={l.id} href={l.href} className="luxury-footer__link">
                    {l.label}
                  </Link>
                ))}
                <a href={`mailto:${settings?.email ?? site.email}`} className="luxury-footer__link">
                  {settings?.email ?? site.email}
                </a>
              </div>
            </div>
            <div>
              <p className="luxury-footer__heading">Atelier</p>
              <p className="mt-2.5 text-sm leading-relaxed text-[rgba(250,246,238,0.72)]">
                {settings?.address ?? site.address}
              </p>
              <p className="mt-1 text-sm text-[rgba(250,246,238,0.55)]">
                {settings?.hours ?? "Tue–Sun, 11:00–19:00"}
              </p>
              <p className="mt-1 text-sm text-[rgba(250,246,238,0.55)]">{settings?.phone ?? site.phone}</p>
            </div>
          </div>
        </div>

        <div className="gold-line mt-6" />
        <p className="mt-3 text-center text-[10px] tracking-[0.22em] text-[rgba(250,246,238,0.45)] uppercase">
          © {year} {settings?.name ?? "Avyora"}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
