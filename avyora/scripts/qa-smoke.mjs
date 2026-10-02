const checks = [
  { name: "storefront-root", url: "http://localhost:3000/", expected: 200, redirect: "manual" },
  { name: "storefront-health", url: "http://localhost:3000/api/health", expected: 200, expectHealth: true },
  { name: "admin-root-redirect", url: "http://localhost:3001/", expected: 307, redirect: "manual" },
  { name: "admin-health", url: "http://localhost:3001/api/health", expected: 200, expectHealth: true },
  { name: "logistics-root-redirect", url: "http://localhost:3002/", expected: 307, redirect: "manual" },
  { name: "logistics-health", url: "http://localhost:3002/api/health", expected: 200, expectHealth: true },
  { name: "logistics-orders-unauth-forbidden", url: "http://localhost:3002/api/logistics/orders", expected: 401 },
  { name: "logistics-order-detail-unauth-forbidden", url: "http://localhost:3002/api/logistics/orders/AV33623465", expected: 401 },
  { name: "search-hit", url: "http://localhost:3000/api/search?q=solitaire", expected: 200, expectHits: true },
  { name: "search-miss", url: "http://localhost:3000/api/search?q=definitelynotaproduct", expected: 200, expectHits: false },
];

let failed = 0;

for (const check of checks) {
  const response = await fetch(check.url, { redirect: check.redirect ?? "follow" });
  if (response.status !== check.expected) {
    // Health may be 503 if DB is down — still surface as fail.
    failed += 1;
    console.error(`[FAIL] ${check.name}: expected ${check.expected}, got ${response.status}`);
    continue;
  }

  if (check.expectHealth) {
    const body = await response.json();
    if (!body?.ok || body?.db !== true) {
      failed += 1;
      console.error(`[FAIL] ${check.name}: unhealthy payload ${JSON.stringify(body)}`);
      continue;
    }
  }

  if (typeof check.expectHits === "boolean") {
    const body = await response.json();
    const hits = Array.isArray(body?.data?.hits) ? body.data.hits : Array.isArray(body?.hits) ? body.hits : [];
    const hasHits = hits.length > 0;
    if (hasHits !== check.expectHits) {
      failed += 1;
      console.error(`[FAIL] ${check.name}: unexpected hit count ${hits.length}`);
      continue;
    }
  }

  console.log(`[PASS] ${check.name}`);
}

if (failed > 0) {
  console.error(`\n${failed} QA smoke check(s) failed.`);
  process.exit(1);
}

console.log("\nAll QA smoke checks passed.");
