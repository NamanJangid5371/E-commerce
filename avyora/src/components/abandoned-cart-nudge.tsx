"use client";

import { formatINR } from "@/lib/format";
import { useCartTotals, useShopStore } from "@/store/shop-store";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const STORAGE_KEY = "avyora-cart-nudge";

/** Soft abandoned-cart nudge when the bag still has items after leaving checkout. */
export function AbandonedCartNudge() {
  const pathname = usePathname();
  const cart = useShopStore((s) => s.cart);
  const totals = useCartTotals();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!cart.length) {
      localStorage.removeItem(STORAGE_KEY);
      setShow(false);
      return;
    }
    const now = Date.now();
    const raw = localStorage.getItem(STORAGE_KEY);
    const prev = raw ? Number(raw) : now;
    if (!raw) localStorage.setItem(STORAGE_KEY, String(now));

    const idleMs = now - prev;
    const onQuietPage =
      !pathname.startsWith("/checkout") &&
      !pathname.startsWith("/cart") &&
      !pathname.startsWith("/admin") &&
      !pathname.startsWith("/staff-login");

    // Show after ~2 minutes with items still in bag, or immediately if returning later
    if (onQuietPage && idleMs > 2 * 60 * 1000) {
      setShow(true);
    }
  }, [cart.length, pathname]);

  useEffect(() => {
    if (!cart.length) return;
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  }, [cart]);

  if (!show || !cart.length) return null;

  return (
    <div className="shadow-soft fixed bottom-20 left-4 right-4 z-40 mx-auto max-w-md border border-line bg-paper p-4 md:bottom-6 md:left-auto md:right-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] tracking-[0.16em] uppercase text-gold-deep">Your bag is waiting</p>
          <p className="mt-1 text-sm">
            {cart.reduce((n, i) => n + i.quantity, 0)} piece
            {cart.reduce((n, i) => n + i.quantity, 0) === 1 ? "" : "s"} · {formatINR(totals.total)}
          </p>
        </div>
        <button
          type="button"
          className="text-xs text-ink-soft underline"
          onClick={() => setShow(false)}
          aria-label="Dismiss"
        >
          Dismiss
        </button>
      </div>
      <Link href="/checkout" className="btn-primary mt-3 inline-flex w-full justify-center py-2.5" onClick={() => setShow(false)}>
        Complete checkout
      </Link>
    </div>
  );
}
