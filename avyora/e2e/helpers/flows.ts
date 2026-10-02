import { expect, type Page } from "@playwright/test";
import { ORIGINS, PRODUCT_PATH, STAFF } from "./env";

export function uniqueGuestEmail(prefix = "e2e") {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e4)}@example.com`;
}

export async function addSolenneToBag(page: Page) {
  await page.goto(`${ORIGINS.store}${PRODUCT_PATH}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const add = page.getByRole("button", { name: /^Add to bag$/i }).first();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByRole("button", { name: /^Added to bag$/i }).first()).toBeVisible({
    timeout: 10_000,
  });
}

export async function placeGuestCodOrder(page: Page, email: string) {
  await addSolenneToBag(page);

  // Navigate via cart so Zustand persist/rehydrate keeps the bag across full page loads.
  await page.goto(`${ORIGINS.store}/cart`);
  await expect(page.getByRole("heading", { name: /Your bag/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Checkout$/i })).toBeVisible();
  await page.getByRole("link", { name: /^Checkout$/i }).click();
  await expect(page.getByRole("heading", { name: /Delivery & payment/i })).toBeVisible();
  await expect(page.getByPlaceholder("Full name")).toBeVisible();

  await page.getByPlaceholder("Full name").fill("E2E Guest");
  await page.getByPlaceholder("Phone").fill("9876543210");
  await page.getByPlaceholder("Email for order updates").fill(email);
  await page.getByPlaceholder("Address").fill("12 Atelier Lane");
  await page.getByPlaceholder("PIN code").fill("560001");
  await page.getByPlaceholder("City").fill("Bengaluru");
  await page.getByPlaceholder("State").fill("Karnataka");

  const cod = page.getByText("Cash on delivery", { exact: true });
  await expect(cod).toBeVisible({ timeout: 20_000 });
  await cod.click();
  await expect(page.getByRole("button", { name: /Place COD order/i })).toBeVisible();

  await Promise.all([
    page.waitForURL(/\/orders\//, { timeout: 60_000 }),
    page.getByRole("button", { name: /Place COD order/i }).click(),
  ]);

  const match = page.url().match(/\/orders\/([^/?#]+)/);
  const orderId = match?.[1];
  if (!orderId) throw new Error(`Could not parse order id from ${page.url()}`);
  await expect(page.getByRole("heading", { name: orderId })).toBeVisible();
  return orderId;
}

export async function trackOrder(page: Page, orderId: string, email: string) {
  await page.goto(`${ORIGINS.store}/track`);
  await page.getByLabel("Order ID").fill(orderId);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /Track shipment/i }).click();
  await expect(page.getByRole("heading", { name: orderId })).toBeVisible({ timeout: 20_000 });
}

export async function staffLogin(page: Page, portal: "admin" | "logistics") {
  const origin = portal === "admin" ? ORIGINS.admin : ORIGINS.logistics;
  const path = portal === "admin" ? "/staff-login" : "/logistics-login";
  const submit = portal === "admin" ? /Enter admin/i : /Enter logistics/i;
  const home = portal === "admin" ? /\/admin(?:\/|$)/ : /\/logistics(?:\/|$)/;

  await page.goto(`${origin}${path}`);
  await page.getByPlaceholder("name@avyora.com").fill(STAFF.email);
  await page.getByPlaceholder("Password").fill(STAFF.password);

  await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/auth/staff/login") && res.request().method() === "POST",
      { timeout: 45_000 },
    ),
    page.getByRole("button", { name: submit }).click(),
  ]);

  await page.waitForURL(home, { timeout: 45_000 });

  // Confirm JWT cookies work for staff APIs (not only the local admin cookie).
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${origin}/api/logistics/orders?pageSize=1`);
        // Admin portal may not expose logistics routes the same way — only assert on logistics.
        if (portal !== "logistics") return 200;
        return res.status();
      },
      { timeout: 20_000 },
    )
    .toBe(200);
}

export async function waitForLogisticsOrder(page: Page, orderId: string) {
  await expect
    .poll(
      async () => {
        const res = await page.request.get(
          `${ORIGINS.logistics}/api/logistics/orders/${encodeURIComponent(orderId)}`,
        );
        return res.status();
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] },
    )
    .toBe(200);
}

export async function advanceLogisticsStatus(page: Page, status: string) {
  await page.getByLabel("New status").selectOption(status);
  await page.getByRole("button", { name: /^Update status$/i }).click();
  await expect(page.getByText(new RegExp(`Order moved to ${status}`, "i"))).toBeVisible({
    timeout: 20_000,
  });
}
