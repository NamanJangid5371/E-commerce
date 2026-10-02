import { expect, test } from "@playwright/test";
import { ORIGINS } from "./helpers/env";
import {
  advanceLogisticsStatus,
  placeGuestCodOrder,
  staffLogin,
  trackOrder,
  uniqueGuestEmail,
  waitForLogisticsOrder,
} from "./helpers/flows";

/**
 * Critical path: guest COD checkout → track → logistics status advance → track again.
 * Requires Postgres (checkout place) + all three portals.
 */
test.describe.serial("critical path: checkout → logistics → track", () => {
  test("guest COD order is visible to logistics and trackable after status update", async ({
    browser,
  }) => {
    const email = uniqueGuestEmail("critical");
    const store = await browser.newPage();
    const logistics = await browser.newPage();

    const orderId = await placeGuestCodOrder(store, email);

    await trackOrder(store, orderId, email);
    await expect(store.getByText(orderId, { exact: true }).first()).toBeVisible();
    await expect(store.getByText(/Confirmed|Payment confirmed|Order confirmed/i).first()).toBeVisible();

    await staffLogin(logistics, "logistics");
    await waitForLogisticsOrder(logistics, orderId);
    await logistics.goto(`${ORIGINS.logistics}/logistics/orders/${encodeURIComponent(orderId)}`);
    await expect(logistics.getByRole("heading", { name: orderId })).toBeVisible({ timeout: 30_000 });

    // PAYMENT_CONFIRMED maps to Confirmed → advance one stage at a time.
    await advanceLogisticsStatus(logistics, "Processing");
    await advanceLogisticsStatus(logistics, "Packed");
    await expect(logistics.getByText("Packed").first()).toBeVisible();

    await expect
      .poll(
        async () => {
          const res = await store.request.post(`${ORIGINS.store}/api/orders/track`, {
            data: { orderId, email },
          });
          if (!res.ok()) return "";
          const payload = (await res.json()) as { data?: { status?: string } };
          return payload.data?.status ?? "";
        },
        { timeout: 30_000, intervals: [1_000, 2_000, 3_000] },
      )
      .toBe("Packed");

    await trackOrder(store, orderId, email);
    await expect(store.getByText("Packed").first()).toBeVisible();

    await store.close();
    await logistics.close();
  });
});
