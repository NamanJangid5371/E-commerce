import { expect, test } from "@playwright/test";
import { ORIGINS } from "./helpers/env";
import { staffLogin } from "./helpers/flows";

test.describe("auth gates", () => {
  test("logistics API rejects unauthenticated access", async ({ request }) => {
    const list = await request.get(`${ORIGINS.logistics}/api/logistics/orders`);
    expect([401, 403]).toContain(list.status());

    const detail = await request.get(`${ORIGINS.logistics}/api/logistics/orders/AVY-TEST`);
    expect([401, 403, 404]).toContain(detail.status());
  });

  test("admin and logistics portals redirect unauthenticated users to staff login", async ({
    page,
  }) => {
    await page.goto(`${ORIGINS.admin}/admin/orders`);
    await expect(page).toHaveURL(/staff-login/, { timeout: 20_000 });

    await page.goto(`${ORIGINS.logistics}/logistics/orders`);
    await expect(page).toHaveURL(/logistics-login/, { timeout: 20_000 });
  });

  test("staff can sign in to admin", async ({ page }) => {
    await staffLogin(page, "admin");
    await expect(page).toHaveURL(/\/admin/);
    await page.goto(`${ORIGINS.admin}/admin/orders`);
    await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
  });
});
