"use client";

import { ToastProvider } from "@/components/toast";
import { fetchCommerce, isAdminHost, isLogisticsHost, putCommerce } from "@/lib/host";
import { seedAdminOps } from "@/data/admin-ops";
import { useShopStore } from "@/store/shop-store";
import type { Order } from "@/store/shop-types";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const COMMERCE_KEYS = [
  "catalog",
  "collections",
  "coupons",
  // orders + customers are Postgres SoT — synced via staff APIs, not PUT /api/commerce
  "campaigns",
  "mediaUrls",
  "audit",
  "appointments",
  "ops",
] as const;

let bootPromise: Promise<string | undefined> | null = null;
let applyingRemoteCommerce = false;
/** Prevents admin poll from overwriting in-flight local edits before PUT finishes. */
let commerceDirty = false;
let putQueue: Promise<void> = Promise.resolve();

/** Restore staff UI session from verified JWT only — never from unsigned avyora_admin. */
async function restoreStaffSessionFromJwt() {
  if (!isAdminHost() && !isLogisticsHost()) return;
  try {
    const { ensureStaffSession } = await import("@/lib/staff-auth");
    const session = await ensureStaffSession();
    if (!session) {
      // Transient probe/refresh failure must NOT wipe a working admin session —
      // that caused login loops on every navigation when poll raced refresh rotation.
      return;
    }
    const ops = useShopStore.getState().ops ?? seedAdminOps();
    const roster = ops.adminUsers.find(
      (u) => u.email.toLowerCase() === session.email.toLowerCase() && u.active,
    );
    useShopStore.setState({
      user: {
        id: roster?.id ?? session.userId,
        name: roster?.name ?? session.email.split("@")[0],
        email: session.email,
        role: "admin",
      },
      ops,
    });
  } catch {
    /* network — leave store as-is until next poll */
  }
}

function snapshotPayload(state: ReturnType<typeof useShopStore.getState>) {
  return {
    catalog: state.catalog,
    collections: state.collections,
    coupons: state.coupons,
    campaigns: state.campaigns,
    mediaUrls: state.mediaUrls,
    audit: state.audit,
    appointments: state.appointments,
    ops: state.ops,
  };
}

/** Flush current admin commerce state to disk; used by collection/product editors. */
export function persistCommerceNow(): Promise<{ updatedAt?: string }> {
  commerceDirty = true;
  const run = putQueue.then(async () => {
    try {
      const result = await putCommerce(snapshotPayload(useShopStore.getState()));
      commerceDirty = false;
      return result;
    } catch (error) {
      commerceDirty = false;
      throw error;
    }
  });
  putQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function bootStore() {
  try {
    await useShopStore.persist.rehydrate();
  } catch {
    /* empty / corrupt storage — continue with seeds */
  }

  if (isAdminHost()) {
    const current = useShopStore.getState().user;
    if (current && current.role !== "admin") {
      useShopStore.setState({ user: null });
    }
  } else if (!isLogisticsHost()) {
    const current = useShopStore.getState().user;
    if (current?.role === "admin") {
      useShopStore.setState({ user: null });
    }
  }

  await restoreStaffSessionFromJwt();
  if (!isAdminHost() && !isLogisticsHost()) {
    const { restoreCustomerSessionFromJwt } = await import("@/lib/customer-auth");
    await restoreCustomerSessionFromJwt();
  }
  useShopStore.getState().setHydrated();

  try {
    const data = await fetchCommerce();
    applyingRemoteCommerce = true;
    useShopStore.getState().applyCommerce(data);
    applyingRemoteCommerce = false;
    if (isAdminHost() || isLogisticsHost()) await restoreStaffSessionFromJwt();

    // Staff: also pull Prisma-backed orders so admin/logistics aren't stuck on empty commerce.
    if (isAdminHost() || isLogisticsHost()) {
      try {
        const ordersUrl = isAdminHost()
          ? "/api/admin/orders?limit=100"
          : "/api/logistics/orders?pageSize=100";
        const ordersRes = await fetch(ordersUrl, { credentials: "include", cache: "no-store" });
        if (ordersRes.ok) {
          const payload = (await ordersRes.json()) as {
            data?: { orders?: Order[] };
            orders?: Order[];
          };
          const list = payload.data?.orders ?? payload.orders;
          if (Array.isArray(list) && list.length) {
            useShopStore.getState().mergeOrders(list);
          }
        }
      } catch {
        /* orders API optional when commerce already populated */
      }
    }

    // Restore durable account addresses after login session hydrate.
    if (!isAdminHost() && !isLogisticsHost() && useShopStore.getState().user?.role === "customer") {
      const { hydrateAccountAddresses } = await import("@/lib/account-addresses");
      await hydrateAccountAddresses();
    }

    try {
      const aptRes = await fetch("/api/appointments", { credentials: "include", cache: "no-store" });
      if (aptRes.ok) {
        const aptData = (await aptRes.json()) as {
          appointments?: unknown[];
        };
        if (Array.isArray(aptData.appointments) && aptData.appointments.length) {
          useShopStore.setState((state) => {
            const incoming = aptData.appointments as typeof state.appointments;
            if (isAdminHost() || isLogisticsHost()) {
              return { appointments: incoming };
            }
            const byId = new Map(state.appointments.map((a) => [a.id, a]));
            for (const a of incoming) byId.set(a.id, a);
            return { appointments: [...byId.values()] };
          });
        }
      }
    } catch {
      /* appointments optional on boot */
    }

    return data.updatedAt as string | undefined;
  } catch {
    applyingRemoteCommerce = false;
    return undefined;
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const lastSyncRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!bootPromise) bootPromise = bootStore();
    void bootPromise.then((updatedAt) => {
      if (updatedAt) lastSyncRef.current = updatedAt;
    });

    const unsub = useShopStore.subscribe((state, prev) => {
      if (!state.hydrated) return;
      if (applyingRemoteCommerce) return;
      if (!isAdminHost()) return;
      const changed = COMMERCE_KEYS.some((key) => state[key] !== prev[key]);
      if (!changed) return;

      commerceDirty = true;
      putQueue = putQueue
        .then(async () => {
          try {
            const result = await putCommerce(snapshotPayload(useShopStore.getState()));
            if (result.updatedAt) lastSyncRef.current = result.updatedAt;
            commerceDirty = false;
          } catch (error) {
            console.error("[commerce] save failed", error);
            commerceDirty = false;
          }
        })
        .catch(() => undefined);
    });

    const pullCommerce = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (commerceDirty) return;
      void fetchCommerce()
        .then((data) => {
          if (commerceDirty) return;
          if (data.updatedAt && data.updatedAt === lastSyncRef.current) return;
          lastSyncRef.current = data.updatedAt;
          applyingRemoteCommerce = true;
          useShopStore.getState().applyCommerce(data);
          applyingRemoteCommerce = false;
          // Do NOT re-probe JWT on every poll — that raced refresh rotation and forced logouts.
        })
        .catch(() => undefined)
        .finally(() => {
          applyingRemoteCommerce = false;
        });
    };

    const onFocus = () => {
      pullCommerce();
      if (isAdminHost() || isLogisticsHost()) void restoreStaffSessionFromJwt();
    };

    window.addEventListener("focus", onFocus);

    const pollMs = isAdminHost() || isLogisticsHost() ? 4000 : 8000;
    const poll = window.setInterval(pullCommerce, pollMs);

    // Occasional quiet session keep-alive (refresh if needed) — not tied to commerce sync.
    const sessionKeepAlive = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (!isAdminHost() && !isLogisticsHost()) return;
      void restoreStaffSessionFromJwt();
    }, 10 * 60 * 1000);

    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
      window.clearInterval(poll);
      window.clearInterval(sessionKeepAlive);
    };
  }, []);

  useEffect(() => {
    if (isAdminHost() || isLogisticsHost()) return;
    if (pathname.startsWith("/admin") || pathname.startsWith("/staff-login") || pathname.startsWith("/logistics")) {
      return;
    }
    useShopStore.getState().logVisit();

    if (pathname.startsWith("/collections") || pathname.startsWith("/shop") || pathname.startsWith("/product")) {
      void fetchCommerce()
        .then((data) => {
          if (data.updatedAt && data.updatedAt === lastSyncRef.current) return;
          lastSyncRef.current = data.updatedAt;
          applyingRemoteCommerce = true;
          useShopStore.getState().applyCommerce(data);
          applyingRemoteCommerce = false;
        })
        .catch(() => undefined)
        .finally(() => {
          applyingRemoteCommerce = false;
        });
    }
  }, [pathname]);

  return <ToastProvider>{children}</ToastProvider>;
}
