import { Providers } from "@/components/providers";
import { AbandonedCartNudge } from "@/components/abandoned-cart-nudge";
import { RestockWatcher } from "@/components/restock-watcher";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { Metadata } from "next";
import { Cinzel, Cormorant_Garamond, IBM_Plex_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";

const display = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
});

const brand = Cinzel({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Avyora — Timeless Jewellery",
    template: "%s · Avyora",
  },
  description:
    "Shop hallmarked gold, silver and diamond jewellery online from Avyora. Free shipping on eligible orders, easy exchange.",
  metadataBase: new URL("https://avyora.example.com"),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${brand.variable} ${mono.variable} h-full`}>
      <body className="flex min-h-full flex-col font-sans antialiased">
        <Providers>
          <Suspense fallback={<div className="luxury-header min-h-[6.5rem]" aria-hidden />}>
            <SiteHeader />
          </Suspense>
          <main className="flex-1">{children}</main>
          <SiteFooter />
          <AbandonedCartNudge />
          <RestockWatcher />
        </Providers>
      </body>
    </html>
  );
}
