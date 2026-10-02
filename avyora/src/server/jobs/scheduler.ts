/**
 * Lightweight in-process scheduler for ops jobs.
 * Disabled when JOBS_SCHEDULER=false. Prefer /api/cron/tick in multi-instance deploys.
 */

import { enqueue, registeredJobs } from "@/server/jobs/runner";
import { logger } from "@/server/logger";

const globalKey = "__avyora_job_scheduler__";

type SchedulerState = {
  started: boolean;
  timers: NodeJS.Timeout[];
};

function state(): SchedulerState {
  const g = globalThis as typeof globalThis & { [globalKey]?: SchedulerState };
  if (!g[globalKey]) {
    g[globalKey] = { started: false, timers: [] };
  }
  return g[globalKey]!;
}

export function startJobScheduler(): void {
  if (process.env.JOBS_SCHEDULER === "false") return;
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;

  const s = state();
  if (s.started) return;
  s.started = true;

  const minute = 60 * 1000;
  const hour = 60 * minute;

  s.timers.push(
    setInterval(() => {
      if (registeredJobs().includes("pending-payment-release")) {
        enqueue("pending-payment-release");
      }
    }, 5 * minute),
  );
  s.timers.push(
    setInterval(() => {
      if (registeredJobs().includes("abandoned-cart-scan")) {
        enqueue("abandoned-cart-scan");
      }
    }, hour),
  );
  s.timers.push(
    setInterval(() => {
      if (registeredJobs().includes("search-reindex")) {
        enqueue("search-reindex");
      }
    }, 6 * hour),
  );

  // Unref so Next.js can exit in scripts; intervals still run while the server is up.
  for (const t of s.timers) {
    t.unref?.();
  }

  logger.info("jobs.scheduler_started", {
    jobs: registeredJobs(),
    pendingPaymentReleaseMs: 5 * minute,
    abandonedCartMs: hour,
    searchReindexMs: 6 * hour,
  });
}
