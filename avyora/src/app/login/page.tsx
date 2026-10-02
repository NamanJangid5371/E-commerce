"use client";

import { BrandLogo } from "@/components/brand-logo";
import { ADMIN_ORIGIN, fetchCommerce } from "@/lib/host";
import { useShopStore } from "@/store/shop-store";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

const POST_LOGIN_PATH = "/";

function PasswordField({
  value,
  onChange,
  placeholder,
  autoComplete,
  minLength,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: string;
  minLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        required
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        minLength={minLength}
        className="w-full border border-line bg-transparent px-4 py-3 pr-16"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] tracking-widest uppercase text-ink-soft hover:text-ink"
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

function CustomerLoginForm() {
  const login = useShopStore((s) => s.login);
  const register = useShopStore((s) => s.register);
  const user = useShopStore((s) => s.user);
  const hydrated = useShopStore((s) => s.hydrated);
  const router = useRouter();
  const search = useSearchParams();
  const initialMode = search.get("mode");

  const [mode, setMode] = useState<"in" | "up" | "forgot" | "reset">(
    initialMode === "up" ? "up" : initialMode === "forgot" || initialMode === "reset" ? (initialMode as "forgot" | "reset") : "in",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [terms, setTerms] = useState(false);
  const [remember, setRemember] = useState(true);
  const [resetToken, setResetToken] = useState(search.get("token") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const redirected = useRef(false);

  const goAfterLogin = useCallback(
    (path = POST_LOGIN_PATH) => {
      redirected.current = true;
      setBusy(false);
      router.replace(path);
      // Hard fallback — some Next navigations can stall after auth state updates.
      window.setTimeout(() => {
        if (window.location.pathname.startsWith("/login")) {
          window.location.assign(path);
        }
      }, 150);
    },
    [router],
  );

  const title = useMemo(() => {
    if (mode === "forgot") return "Forgot password";
    if (mode === "reset") return "Reset password";
    return mode === "in" ? "Client sign in" : "Create client account";
  }, [mode]);

  useEffect(() => {
    const token = search.get("token");
    const mail = search.get("email");
    if (search.get("mode") === "reset" || (token && mail)) {
      setMode("reset");
      if (mail) setEmail(mail);
      if (token) setResetToken(token);
    }
  }, [search]);

  useEffect(() => {
    if (!hydrated || redirected.current) return;

    const switchAccount = search.get("switch") === "1";
    if (switchAccount) {
      void (async () => {
        const { logoutCustomer } = await import("@/lib/customer-auth");
        await logoutCustomer();
        router.replace("/login");
      })();
      return;
    }

    // Staff sessions do not belong on the storefront login.
    if (user?.role === "admin") {
      void (async () => {
        const { logoutCustomer } = await import("@/lib/customer-auth");
        await logoutCustomer();
      })();
      return;
    }
    if (!user) return;
    goAfterLogin(POST_LOGIN_PATH);
  }, [user, hydrated, goAfterLogin, search, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("avyora-remember-email");
    if (saved) {
      setEmail(saved);
      setRemember(true);
    }
  }, []);

  async function syncCommerce() {
    try {
      const data = await fetchCommerce();
      useShopStore.getState().applyCommerce(data);
    } catch {
      /* keep local state if API is briefly unavailable */
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setInfo(null);
    setBusy(true);

    if (mode === "forgot") {
      try {
        const res = await fetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = (await res.json()) as { ok?: boolean; message?: string; code?: string };
        if (!res.ok || !data.ok) {
          setError(data.message || "Could not start password recovery.");
          setBusy(false);
          return;
        }
        setInfo(data.message || "Check your inbox for a 6-digit recovery code.");
        await syncCommerce();
        setMode("reset");
        // Auto-fill when API returns a local Outlook fallback code.
        setResetToken(data.code && /^\d{6}$/.test(data.code) ? data.code : "");
        setPassword("");
        setConfirm("");
      } catch {
        setError("Could not reach the recovery service. Please try again.");
      }
      setBusy(false);
      return;
    }

    if (mode === "reset") {
      if (password !== confirm) {
        setError("Passwords do not match.");
        setBusy(false);
        return;
      }
      try {
        const res = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, token: resetToken, password }),
        });
        const data = (await res.json()) as { ok?: boolean; message?: string };
        if (!res.ok || !data.ok) {
          setError(data.message || "Could not update password.");
          setBusy(false);
          return;
        }
        await syncCommerce();
        setInfo(data.message || "Password updated. Sign in with your new password.");
        setMode("in");
        setPassword("");
        setConfirm("");
        setResetToken("");
      } catch {
        setError("Could not update password right now. Please try again.");
      }
      setBusy(false);
      return;
    }

    if (mode === "up") {
      if (password !== confirm) {
        setError("Passwords do not match.");
        setBusy(false);
        return;
      }
      if (!terms) {
        setError("Please accept the terms and privacy policy.");
        setBusy(false);
        return;
      }
      try {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          message?: string;
          error?: string;
          data?: {
            user: { id: string; name: string; email: string };
            customer?: { id: string; groupId?: string | null };
          };
        };
        if (!res.ok || !data.ok) {
          setError(data.error || data.message || "Could not create account.");
          setBusy(false);
          return;
        }

        // Establish a real JWT session so the new account works like any other customer.
        const loginRes = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, password }),
        });

        const { applyCustomerSession } = await import("@/lib/customer-auth");

        if (loginRes.ok) {
          const loginData = (await loginRes.json()) as {
            ok?: boolean;
            data?: {
              user: { id: string; name: string; email: string };
              customer?: { id: string; groupId?: string | null };
            };
          };
          if (loginData.ok && loginData.data?.user) {
            applyCustomerSession(loginData.data, { resetBrowserBag: true });
          } else if (data.data?.user) {
            applyCustomerSession(data.data, { resetBrowserBag: true });
            register(name, email, password);
          }
        } else if (loginRes.status === 503) {
          const localErr = register(name, email, password);
          if (localErr && !localErr.toLowerCase().includes("already exists")) {
            setError(localErr);
            setBusy(false);
            return;
          }
          if (localErr) {
            const loginErr = login(email, password);
            if (loginErr) {
              setError(loginErr);
              setBusy(false);
              return;
            }
          }
        } else if (data.data?.user) {
          applyCustomerSession(data.data, { resetBrowserBag: true });
        } else {
          setError("Account created, but sign-in failed. Please sign in.");
          setBusy(false);
          setMode("in");
          return;
        }

        void fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }).catch(() => undefined);
      } catch {
        setError("Could not create account right now. Please try again.");
        setBusy(false);
        return;
      }

      if (typeof window !== "undefined") {
        if (remember) localStorage.setItem("avyora-remember-email", email.trim().toLowerCase());
        else localStorage.removeItem("avyora-remember-email");
      }

      redirected.current = true;
      goAfterLogin(`${POST_LOGIN_PATH}?welcome=1`);
      return;
    }

    if (mode === "in") {
      let loggedIn = false;

      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, password }),
        });

        if (res.status === 503) {
          loggedIn = !login(email, password);
        } else {
          const data = (await res.json()) as {
            ok?: boolean;
            error?: string;
            data?: {
              user: { id: string; name: string; email: string };
              customer?: { id: string; groupId?: string | null };
            };
          };

          if (!res.ok || !data.ok || !data.data?.user) {
            setError(data.error || "Incorrect email or password.");
            setBusy(false);
            return;
          }

          // Always trust the server user — do not require the local customers roster.
          const { applyCustomerSession } = await import("@/lib/customer-auth");
          applyCustomerSession(data.data, { resetBrowserBag: true });
          loggedIn = true;
        }
      } catch {
        loggedIn = !login(email, password);
      }

      if (!loggedIn) {
        setError("Incorrect email or password.");
        setBusy(false);
        return;
      }

      if (typeof window !== "undefined") {
        if (remember) localStorage.setItem("avyora-remember-email", email.trim().toLowerCase());
        else localStorage.removeItem("avyora-remember-email");
      }

      const { hydrateAccountAddresses } = await import("@/lib/account-addresses");
      await hydrateAccountAddresses();
      goAfterLogin(POST_LOGIN_PATH);
      return;
    }
  }

  function switchMode(next: "in" | "up" | "forgot") {
    setMode(next);
    setError(null);
    setInfo(null);
    setPassword("");
    setConfirm("");
  }

  return (
      <div className="mx-auto max-w-md px-4 py-14">
      <div className="mb-8 flex justify-center">
        <BrandLogo href="/" size="lg" />
      </div>
      <p className="text-sm font-semibold text-gold-deep">Account</p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-3 text-sm text-ink-soft">
        {mode === "in"
          ? "Sign in with your client email to manage orders, addresses, and wishlist."
          : mode === "up"
            ? "Create a client account. Staff emails cannot be used here."
              : mode === "forgot"
                ? "Enter your client email. We will send a 6-digit recovery code by email."
                : "Enter the 6-digit code from your email (or the local fallback shown above if you use Outlook), then choose a new password."}
      </p>

      <form onSubmit={onSubmit} className="mt-10 space-y-4">
        {mode === "up" && (
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            autoComplete="name"
            className="w-full border border-line bg-transparent px-4 py-3"
          />
        )}

        <input
          required
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Client email"
          autoComplete="email"
          className="w-full border border-line bg-transparent px-4 py-3"
        />

        {mode === "reset" && (
          <input
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={resetToken}
            onChange={(e) => setResetToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="6-digit recovery code"
            className="w-full border border-line bg-transparent px-4 py-3 tracking-[0.35em]"
          />
        )}

        {(mode === "in" || mode === "up" || mode === "reset") && (
          <PasswordField
            value={password}
            onChange={setPassword}
            placeholder={mode === "reset" ? "New password" : "Password"}
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            minLength={8}
          />
        )}

        {(mode === "up" || mode === "reset") && (
          <>
            <PasswordField
              value={confirm}
              onChange={setConfirm}
              placeholder="Confirm password"
              autoComplete="new-password"
              minLength={8}
            />
            <p className="text-xs text-ink-soft">Use at least 8 characters with a letter and a number.</p>
          </>
        )}

        {mode === "up" && (
          <label className="flex items-start gap-3 text-sm text-ink-soft">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1" />
            <span>
              I agree to the{" "}
              <Link href="/policies/terms" className="underline text-ink">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/policies/privacy" className="underline text-ink">
                Privacy Policy
              </Link>
              .
            </span>
          </label>
        )}

        {mode === "in" && (
          <label className="flex items-center gap-3 text-sm text-ink-soft">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember me on this device
          </label>
        )}

        {error && <p className="text-sm text-red-800">{error}</p>}
        {info && <p className="text-sm text-ink-soft">{info}</p>}

        <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-50">
          {busy
            ? "Please wait…"
            : mode === "in"
              ? "Sign in"
              : mode === "up"
                ? "Create account"
                : mode === "forgot"
                  ? "Send recovery code"
                  : "Update password"}
        </button>
      </form>

      <div className="mt-6 space-y-3 text-sm">
        {mode === "in" && (
          <>
            <button type="button" className="block underline" onClick={() => switchMode("forgot")}>
              Forgot password?
            </button>
            <button type="button" className="block underline" onClick={() => switchMode("up")}>
              Need an account? Create one
            </button>
          </>
        )}
        {mode === "up" && (
          <button type="button" className="block underline" onClick={() => switchMode("in")}>
            Already a client? Sign in
          </button>
        )}
        {(mode === "forgot" || mode === "reset") && (
          <>
            <button type="button" className="block underline" onClick={() => switchMode("in")}>
              Back to sign in
            </button>
            {mode === "forgot" && (
              <button type="button" className="block underline" onClick={() => switchMode("up")}>
                No account? Create one
              </button>
            )}
          </>
        )}
        <Link href="/shop" className="mt-4 block text-xs tracking-[0.16em] uppercase text-ink-soft underline">
          Continue shopping without signing in
        </Link>
        <p className="mt-8 text-xs text-ink-soft">
          Atelier staff?{" "}
          <a href={`${ADMIN_ORIGIN}/staff-login`} className="underline">
            Staff login (port 3001)
          </a>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md px-4 py-20 text-sm text-ink-soft">Loading…</div>}>
      <CustomerLoginForm />
    </Suspense>
  );
}
