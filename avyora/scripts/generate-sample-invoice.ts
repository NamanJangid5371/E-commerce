/**
 * Generates sample invoice PDFs for visual QA (no DB writes).
 * Usage: npx tsx scripts/generate-sample-invoice.ts
 */
import fs from "fs";
import path from "path";
import { buildOrderInvoicePdf } from "../src/lib/invoice-pdf";
import type { Order } from "../src/store/shop-types";

function baseOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "AVY-DEMO-1001",
    createdAt: "2026-09-10T10:30:00.000Z",
    status: "Delivered",
    items: [
      {
        productId: "p1",
        sku: "RING-18K-6",
        name: "Orbit Solitaire Ring with Very Long Descriptive Product Name for Wrapping",
        image: "/products/ring-1.jpg",
        quantity: 1,
        price: 129900,
      },
      {
        productId: "p2",
        sku: "EAR-STUDS",
        name: "Aster Diamond Studs",
        image: "/products/ear-1.jpg",
        quantity: 2,
        price: 37800,
      },
    ],
    subtotal: 205500,
    discount: 5000,
    shipping: 0,
    tax: 6015,
    total: 206515,
    coupon: "WELCOME5",
    address: {
      id: "a1",
      name: "Ananya Sharma",
      line1: "12, Walton Road, Near The Oberoi",
      line2: "Ashok Nagar",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      phone: "+91 98765 43210",
    },
    paymentId: "pay_demo_xyz",
    paymentStatus: "Success",
    paymentMethod: "Razorpay UPI",
    customerEmail: "ananya@example.com",
    shippingMethodName: "Insured standard",
    trackingId: "AVYTRACK001",
    ...overrides,
  };
}

async function main() {
  const outDir = path.join(process.cwd(), "tmp-invoices");
  fs.mkdirSync(outDir, { recursive: true });

  const samples: { name: string; order: Order }[] = [
    { name: "invoice-2-items.pdf", order: baseOrder() },
    {
      name: "invoice-many-items.pdf",
      order: baseOrder({
        id: "AVY-DEMO-1020",
        items: Array.from({ length: 18 }, (_, i) => ({
          productId: `p${i}`,
          sku: `SKU-${1000 + i}`,
          name:
            i % 3 === 0
              ? `Celeste Pendant Collection Piece Number ${i + 1} with Extended Title That Must Wrap Across Lines`
              : `Classic Band ${i + 1}`,
          image: "/products/ring-1.jpg",
          quantity: (i % 5) + 1,
          price: 15000 + i * 1250,
        })),
        subtotal: 450000,
        discount: 0,
        shipping: 199,
        tax: 13500,
        total: 463699,
        coupon: undefined,
      }),
    },
    {
      name: "invoice-edge-empty-optional.pdf",
      order: baseOrder({
        id: "AVY-DEMO-EDGE",
        customerEmail: undefined,
        address: {
          id: "a2",
          name: "Guest Buyer",
          line1: "Flat 4B, Very Long Residential Complex Name Along Outer Ring Road Sector",
          city: "Bengaluru",
          state: "Karnataka",
          pincode: "560103",
          phone: "",
        },
        discount: 0,
        tax: 0,
        shipping: 0,
        paymentStatus: "Pending",
        paymentMethod: "Cash on Delivery",
        status: "Confirmed",
      }),
    },
  ];

  for (const sample of samples) {
    const buf = await buildOrderInvoicePdf(sample.order, {
      customerName: sample.order.address.name,
      store: { name: "Avyora", taxPercent: 3, returnDays: 15 },
    });
    const file = path.join(outDir, sample.name);
    fs.writeFileSync(file, buf);
    console.log(`Wrote ${file} (${buf.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
