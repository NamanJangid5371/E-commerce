"use client";

import { BrandLogo } from "@/components/brand-logo";
import { STOREFRONT_ORIGIN } from "@/lib/host";
import { hasLogisticsAccess } from "@/lib/staff-permissions";
import { ensureStaffSession, loginStaff, logoutStaff } from "@/lib/staff-auth";
import { useShopStore } from "@/store/shop-store";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useRef, useState } from "react";

function LogisticsLoginForm() {
  const user = useShopStore((s) => s.user);
  const hydrated = useShopStore((s) => s.hydrated);
  const ops = useShopStore((s) => s.ops);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const redirected = useRef(false);

  const nextPath = searchParams.get("next");
  const safeNext =
    nextPath && nextPath.startsWith("/logistics") ? nextPath : "/logistics";

  const account = ops?.adminUsers.find((a) => a.email.toLowerCase() === user?.email.toLowerCase());

  useEffect(() => {
    if (!hydrated || redirected.current) return;
    let cancelled = false;
    void (async () => {
      if (user && user.role !== "admin") {
        await logoutStaff();
        return;
      }
      const session = await ensureStaffSession();
      if (cancelled) return;
      if (session && hasLogisticsAccess(session.permissions)) {
        redirected.current = true;
        router.replace(safeNext);
        return;
      }
      if (session && account && hasLogisticsAccess(account.permissions)) {
        redirected.current = true;
        router.replace(safeNext);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, hydrated, router, account, safeNext]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);

    const result = await loginStaff(email, password);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    if (!hasLogisticsAccess(result.permissions)) {
      await logoutStaff();
      setError("This staff account does not have logistics access.");
      setBusy(false);
      return;
    }

    redirected.current = true;
    router.replace(safeNext);
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#12100e] text-ivory">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
        <BrandLogo inverted size="lg" />
        <p className="mt-2 text-[11px] tracking-[0.22em] uppercase text-[#c4a574]">Logistics portal</p>
        <h1 className="mt-8 text-2xl font-medium tracking-tight sm:text-3xl">Fulfilment sign in</h1>
        <p className="mt-3 text-sm text-ivory/55">
          Staff accounts with order or shipping permissions. Session uses a secure JWT cookie.
        </p>

        <form onSubmit={onSubmit} className="mt-10 space-y-4">
          <label className="block text-sm text-ivory/70">
            Staff email
            <input
              required
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@avyora.com"
              className="mt-1.5 min-h-11 w-full border border-white/15 bg-transparent px-4 py-3 text-base text-ivory placeholder:text-ivory/35"
            />
          </label>
          <label className="block text-sm text-ivory/70">
            Password
            <div className="relative mt-1.5">
              <input
                required
                type={show ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                minLength={8}
                className="min-h-11 w-full border border-white/15 bg-transparent px-4 py-3 pr-16 text-base text-ivory placeholder:text-ivory/35"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] tracking-widest uppercase text-ivory/45 hover:text-ivory"
              >
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          {error && <p className="text-sm text-[#e8b4a0]">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-[#c4a574] px-4 py-3 text-[11px] tracking-[0.2em] uppercase text-[#12100e] transition hover:bg-[#d4b88a] disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Enter logistics"}
          </button>
        </form>

        <div className="mt-10 border-t border-white/10 pt-6 text-xs text-ivory/45">
          <p>Local staff access follows existing admin users with shipping/orders permissions.</p>
          <a href={STOREFRONT_ORIGIN} className="mt-6 inline-block underline underline-offset-4 hover:text-ivory">
            Back to storefront
          </a>
        </div>
      </div>
    </div>
  );
}

export default function LogisticsLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#12100e]" />}>
      <LogisticsLoginForm />
    </Suspense>
  );
}
