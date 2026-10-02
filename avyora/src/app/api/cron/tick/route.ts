import { NextResponse } from "next/server";
import { registeredJobs, runJobNow } from "@/server/jobs/runner";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/**
 * Secure cron tick for ops jobs (abandoned cart, pending-payment release, search reindex).
 * Call with header: Authorization: Bearer $CRON_SECRET
 * Or query: ?secret=$CRON_SECRET
 */
export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured." },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret")?.trim() ?? "";
  if (bearer !== expected && querySecret !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let jobs = ["pending-payment-release", "abandoned-cart-scan", "search-reindex"];
  try {
    const body = (await request.json().catch(() => null)) as { jobs?: string[] } | null;
    if (body?.jobs?.length) jobs = body.jobs;
  } catch {
    /* use defaults */
  }

  const results: { job: string; ok: boolean; error?: string }[] = [];
  for (const job of jobs) {
    if (!registeredJobs().includes(job)) {
      results.push({ job, ok: false, error: "unknown job" });
      continue;
    }
    try {
      await runJobNow(job);
      results.push({ job, ok: true });
    } catch (error) {
      logger.error("cron.tick.job_failed", { job, error: String(error) });
      results.push({ job, ok: false, error: String(error) });
    }
  }

  return NextResponse.json({ ok: true, results });
}

export async function GET(request: Request) {
  return POST(request);
}
