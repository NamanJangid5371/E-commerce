import { seedAdminOps, type AdminOps } from "@/data/admin-ops";
import { collections as seedCollections, coupons as seedCoupons, products as seedProducts } from "@/data/catalog";
import { campaign as seedCampaign } from "@/data/content";
import { filterRetainedOrders } from "@/lib/order-retention";
import type { Collection, Coupon, Product } from "@/data/types";
import type { Appointment, AuditEntry, Campaign, Customer, Order } from "@/store/shop-types";
import { isDatabaseConfigured, prisma } from "@/server/db";
import fs from "fs";
import path from "path";

export type CommerceSnapshot = {
  catalog: Product[];
  collections: Collection[];
  coupons: Coupon[];
  customers: Customer[];
  orders: Order[];
  campaigns: Campaign[];
  mediaUrls: string[];
  audit: AuditEntry[];
  appointments: Appointment[];
  ops: AdminOps;
  updatedAt?: string;
};

const filePath = path.join(process.cwd(), "data", "commerce.json");
const backupPath = `${filePath}.bak`;
const lockPath = `${filePath}.write.lock`;

/** Stable Postgres advisory lock key shared by store/admin/logistics processes. */
const COMMERCE_ADVISORY_LOCK_KEY = 0x41565952; // "AVYR"

const FILE_LOCK_STALE_MS = 30_000;
const FILE_LOCK_WAIT_MS = 15_000;
const FILE_LOCK_RETRY_MS = 40;

/** Re-entrancy for load/save while mutateCommerce already holds the lock. */
let writeLockDepth = 0;

/** Serialize writers inside a single Node process (three portals = three processes). */
let inProcessTail: Promise<unknown> = Promise.resolve();

function isDemoOrder(order: Order) {
  return order.id.startsWith("AVH-");
}

function isDemoAppointment(appointment: Appointment) {
  return appointment.id.startsWith("apt-demo-");
}

function sanitizeVisits(visits: AdminOps["visits"] | undefined): AdminOps["visits"] {
  if (!visits?.length) return [];
  const avg = visits.reduce((s, v) => s + v.count, 0) / visits.length;
  if (visits.length > 60 && avg > 15) return [];
  return visits;
}

export function seedCommerce(): CommerceSnapshot {
  return {
    catalog: seedProducts.map((p) => ({
      ...p,
      status: "published" as const,
      reviews: p.reviews.map((r) => ({ ...r, status: "visible" as const })),
    })),
    collections: seedCollections.map((c) => ({ ...c })),
    coupons: seedCoupons.map((c) => ({ ...c, active: true, usageCount: 0 })),
    customers: [],
    orders: [],
    campaigns: [
      {
        id: "camp-bridal",
        title: seedCampaign.title,
        body: seedCampaign.body,
        image: seedCampaign.image,
        href: "/shop?tag=bridal",
        active: true,
      },
    ],
    mediaUrls: [],
    audit: [],
    appointments: [],
    ops: seedAdminOps(),
  };
}

function mergeParsed(parsed: Partial<CommerceSnapshot>): CommerceSnapshot {
  const seed = seedCommerce();
  const mergedOps: AdminOps = {
    ...seed.ops,
    ...parsed.ops,
    adminUsers: parsed.ops?.adminUsers?.length ? parsed.ops.adminUsers : seed.ops.adminUsers,
    visits: sanitizeVisits(parsed.ops?.visits),
  };

  const orders = filterRetainedOrders((parsed.orders ?? []).filter((o) => !isDemoOrder(o)));
  const appointments = (parsed.appointments ?? []).filter((a) => !isDemoAppointment(a));

  return {
    catalog: parsed.catalog ?? seed.catalog,
    collections: parsed.collections ?? seed.collections,
    coupons: parsed.coupons ?? seed.coupons,
    customers: parsed.customers ?? seed.customers,
    orders,
    campaigns: parsed.campaigns ?? seed.campaigns,
    mediaUrls: parsed.mediaUrls ?? seed.mediaUrls,
    audit: parsed.audit ?? seed.audit,
    appointments,
    ops: mergedOps,
    updatedAt: parsed.updatedAt,
  };
}

function readCommerceUnlocked(): CommerceSnapshot {
  const seed = seedCommerce();
  try {
    if (!fs.existsSync(filePath)) {
      return seed;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CommerceSnapshot>;
    return mergeParsed(parsed);
  } catch (error) {
    console.error("[commerce-db] failed to load commerce.json — keeping file intact", error);
    try {
      if (fs.existsSync(filePath) && !fs.existsSync(backupPath)) {
        fs.copyFileSync(filePath, backupPath);
      }
    } catch {
      /* ignore */
    }
    try {
      if (fs.existsSync(backupPath)) {
        const parsed = JSON.parse(fs.readFileSync(backupPath, "utf8")) as Partial<CommerceSnapshot>;
        return mergeParsed(parsed);
      }
    } catch {
      /* fall through */
    }
    return seed;
  }
}

function writeCommerceUnlocked(snapshot: CommerceSnapshot) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const payload = {
    ...snapshot,
    orders: filterRetainedOrders((snapshot.orders ?? []).filter((o) => !isDemoOrder(o))),
    appointments: snapshot.appointments ?? [],
    updatedAt: new Date().toISOString(),
  };
  try {
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backupPath);
    }
  } catch {
    /* ignore */
  }
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
  fs.copyFileSync(tmpPath, filePath);
  try {
    fs.unlinkSync(tmpPath);
  } catch {
    /* ignore */
  }
}

function sleepSync(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin — short waits only */
  }
}

function tryRemoveStaleFileLock() {
  try {
    if (!fs.existsSync(lockPath)) return;
    const age = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (age > FILE_LOCK_STALE_MS) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    /* ignore */
  }
}

/** Exclusive create lock file — works across containers that share /app/data. */
function withSyncFileLock<T>(fn: () => T): T {
  if (writeLockDepth > 0) {
    return fn();
  }

  const dir = path.dirname(lockPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const started = Date.now();
  while (true) {
    let fd: number | undefined;
    try {
      fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, `${process.pid}:${Date.now()}`);
      writeLockDepth += 1;
      try {
        return fn();
      } finally {
        writeLockDepth -= 1;
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      }
    } catch {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }
      if (Date.now() - started > FILE_LOCK_WAIT_MS) {
        throw new Error("[commerce-db] timed out waiting for commerce.json write lock");
      }
      tryRemoveStaleFileLock();
      sleepSync(FILE_LOCK_RETRY_MS);
    }
  }
}

async function withSyncFileLockAsync<T>(fn: () => T | Promise<T>): Promise<T> {
  if (writeLockDepth > 0) {
    return await fn();
  }

  const dir = path.dirname(lockPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const started = Date.now();
  while (true) {
    let fd: number | undefined;
    try {
      fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, `${process.pid}:${Date.now()}`);
      writeLockDepth += 1;
      try {
        return await fn();
      } finally {
        writeLockDepth -= 1;
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      }
    } catch {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }
      if (Date.now() - started > FILE_LOCK_WAIT_MS) {
        throw new Error("[commerce-db] timed out waiting for commerce.json write lock");
      }
      tryRemoveStaleFileLock();
      await new Promise((r) => setTimeout(r, FILE_LOCK_RETRY_MS));
    }
  }
}

function enqueueInProcess<T>(fn: () => Promise<T>): Promise<T> {
  const run = inProcessTail.then(fn, fn);
  inProcessTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Cross-portal write lock: in-process queue → Postgres advisory lock (when DB up)
 * → shared-volume file lock. Prevents last-write-wins across store/admin/logistics.
 */
async function withCommerceWriteLock<T>(fn: () => T | Promise<T>): Promise<T> {
  return enqueueInProcess(async () => {
    if (isDatabaseConfigured()) {
      try {
        return await prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${COMMERCE_ADVISORY_LOCK_KEY})`;
            return await withSyncFileLockAsync(fn);
          },
          { maxWait: 15_000, timeout: 20_000 },
        );
      } catch (error) {
        // Never retry the mutator — only fall back when the lock/DB layer failed.
        if (error instanceof CommerceMutationAbort) throw error;
        const msg = error instanceof Error ? error.message : String(error);
        const looksLikeLockOrDb =
          /advisory|timed out|timeout|can't reach|ECONNREFUSED|P1001|P1017|Unable to start a transaction|Engine is not yet connected/i.test(
            msg,
          );
        if (!looksLikeLockOrDb) throw error;
        console.warn("[commerce-db] advisory lock unavailable, using file lock only", msg);
      }
    }
    return withSyncFileLockAsync(fn);
  });
}

export function loadCommerce(): CommerceSnapshot {
  const seed = seedCommerce();
  return withSyncFileLock(() => {
    try {
      if (!fs.existsSync(filePath)) {
        writeCommerceUnlocked(seed);
        return seed;
      }
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<CommerceSnapshot>;
      const snapshot = mergeParsed(parsed);

      const hadDemoOrders = (parsed.orders ?? []).some(isDemoOrder);
      const hadExpiredCancelledOrders = (parsed.orders ?? []).length !== snapshot.orders.length;
      const hadDemoAppointments = (parsed.appointments ?? []).some(isDemoAppointment);
      const hadInflatedVisits =
        (parsed.ops?.visits?.length ?? 0) > (snapshot.ops.visits?.length ?? 0);
      if (hadDemoOrders || hadExpiredCancelledOrders || hadDemoAppointments || hadInflatedVisits) {
        writeCommerceUnlocked(snapshot);
      }

      return snapshot;
    } catch (error) {
      console.error("[commerce-db] failed to load commerce.json — keeping file intact", error);
      try {
        if (fs.existsSync(filePath) && !fs.existsSync(backupPath)) {
          fs.copyFileSync(filePath, backupPath);
        }
      } catch {
        /* ignore */
      }
      try {
        if (fs.existsSync(backupPath)) {
          const parsed = JSON.parse(fs.readFileSync(backupPath, "utf8")) as Partial<CommerceSnapshot>;
          return mergeParsed(parsed);
        }
      } catch {
        /* fall through */
      }
      return seed;
    }
  });
}

/**
 * Direct overwrite. Prefer {@link mutateCommerce} for read-modify-write so concurrent
 * portals cannot clobber each other. Still takes the shared file lock.
 */
export function saveCommerce(snapshot: CommerceSnapshot) {
  withSyncFileLock(() => {
    writeCommerceUnlocked(snapshot);
  });
}

/**
 * Atomic read → mutate → write under the cross-portal lock.
 * Always reloads from disk inside the lock (ignores stale in-memory copies).
 */
export async function mutateCommerce(
  mutator: (current: CommerceSnapshot) => CommerceSnapshot | void,
): Promise<CommerceSnapshot> {
  return withCommerceWriteLock(() => {
    const current = readCommerceUnlocked();
    // First-run empty file
    if (!fs.existsSync(filePath)) {
      writeCommerceUnlocked(current);
    }
    const result = mutator(current);
    // `undefined` = abort without writing (caller decided nothing changed).
    if (result === undefined) {
      return current;
    }
    writeCommerceUnlocked(result);
    return readCommerceUnlocked();
  });
}

/** Thrown from a mutator to abort without writing (e.g. appointment slot taken). */
export class CommerceMutationAbort extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = "CommerceMutationAbort";
    this.status = status;
    this.code = code;
  }
}
