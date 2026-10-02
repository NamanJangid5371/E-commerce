import { describe, expect, it } from "vitest";
import { buildOrderInvoicePdf } from "@/lib/invoice-pdf";
import type { Order } from "@/store/shop-types";

function sampleOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "AVY-TEST-1",
    createdAt: "2026-09-10T10:30:00.000Z",
    status: "Delivered",
    items: [
      {
        productId: "p1",
        sku: "SKU-1",
        name: "Orbit Ring with an Extremely Long Product Title That Should Wrap Safely",
        image: "/",
        quantity: 2,
        price: 1299.5,
      },
    ],
    subtotal: 2599,
    discount: 0,
    shipping: 0,
    tax: 78,
    total: 2677,
    address: {
      id: "a1",
      name: "Test User",
      phone: "+91 90000 00000",
      line1: "12 Walton Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
    },
    paymentId: "pay_1",
    paymentStatus: "Success",
    paymentMethod: "UPI",
    customerEmail: "test@example.com",
    ...overrides,
  };
}

describe("buildOrderInvoicePdf", () => {
  it("builds a non-empty PDF for a normal order", async () => {
    const buf = await buildOrderInvoicePdf(sampleOrder());
    expect(buf.byteLength).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });

  it("builds a multi-page PDF for many line items", async () => {
    const buf = await buildOrderInvoicePdf(
      sampleOrder({
        items: Array.from({ length: 20 }, (_, i) => ({
          productId: `p${i}`,
          sku: `SKU-${i}`,
          name: `Product ${i + 1} — ${"Long name ".repeat(8)}`,
          image: "/",
          quantity: i + 1,
          price: 1000 + i,
        })),
      }),
    );
    expect(buf.byteLength).toBeGreaterThan(2000);
    expect(buf.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });

  it("handles missing optional contact fields", async () => {
    const buf = await buildOrderInvoicePdf(
      sampleOrder({
        customerEmail: undefined,
        address: {
          id: "a2",
          name: "Guest",
          phone: "",
          line1: "Somewhere far away with a very long address line that wraps",
          city: "Bengaluru",
          state: "KA",
          pincode: "560001",
        },
        discount: 0,
        tax: 0,
        shipping: 0,
      }),
    );
    expect(buf.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });
});
