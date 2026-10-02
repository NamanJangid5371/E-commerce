#!/usr/bin/env node
/**
 * Lightweight uptime monitor for the three Avyora portals.
 *
 * Usage:
 *   node scripts/monitor.mjs
 *   node scripts/monitor.mjs --watch 30
 *
 * Exit code 1 if any critical check fails (unless --watch).
 */
const STORE = process.env.E2E_STORE_URL || process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN || "http://localhost:3000";
const ADMIN = process.env.E2E_ADMIN_URL || process.env.NEXT_PUBLIC_ADMIN_ORIGIN || "http://localhost:3001";
const LOGISTICS =
  process.env.E2E_LOGISTICS_URL || process.env.NEXT_PUBLIC_LOGISTICS_ORIGIN || "http://localhost:3002";

const watchArg = process.argv.indexOf("--watch");
const watchSeconds = watchArg >= 0 ? Number(process.argv[watchArg + 1] || 30) : 0;

const checks = [
  { name: "store-health", url: `${STORE}/api/health`, expectOk: true },
  { name: "admin-health", url: `${ADMIN}/api/health`, expectOk: true },
  { name: "logistics-health", url: `${LOGISTICS}/api/health`, expectOk: true },
  { name: "store-root", url: `${STORE}/`, expectStatus: [200] },
  { name: "admin-login", url: `${ADMIN}/staff-login`, expectStatus: [200] },
  { name: "logistics-login", url: `${LOGISTICS}/logistics-login`, expectStatus: [200] },
  { name: "logistics-api-unauth", url: `${LOGISTICS}/api/logistics/orders`, expectStatus: [401, 403] },
];

async function runOnce() {
  const started = Date.now();
  let failed = 0;
  const results = [];

  for (const check of checks) {
    const row = { name: check.name, ok: false, status: 0, detail: "" };
    try {
      const res = await fetch(check.url, {
        redirect: "manual",
        headers: { Accept: "application/json, text/html;q=0.9,*/*;q=0.8" },
      });
      row.status = res.status;

      if (check.expectOk) {
        const body = await res.json().catch(() => ({}));
        row.ok = res.ok && body?.ok === true && body?.db === true;
        row.detail = JSON.stringify(body);
        if (!row.ok) failed += 1;
      } else if (check.expectStatus) {
        row.ok = check.expectStatus.includes(res.status);
        row.detail = `status=${res.status}`;
        if (!row.ok) failed += 1;
      }
    } catch (error) {
      failed += 1;
      row.detail = String(error);
    }
    results.push(row);
    const mark = row.ok ? "PASS" : "FAIL";
    console.log(`[${mark}] ${row.name} ${row.status || "-"} ${row.detail}`.slice(0, 200));
  }

  const payload = {
    level: failed ? "error" : "info",
    message: "monitor.scan",
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - started,
    failed,
    results,
  };
  console.log(JSON.stringify(payload));
  return failed;
}

async function main() {
  if (watchSeconds > 0) {
    for (;;) {
      await runOnce();
      await new Promise((r) => setTimeout(r, watchSeconds * 1000));
    }
  }

  const failed = await runOnce();
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
