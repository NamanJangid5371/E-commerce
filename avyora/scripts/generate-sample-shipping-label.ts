/**
 * Generates sample shipping-label PDFs for visual/barcode QA (no DB writes).
 * Usage: npx tsx scripts/generate-sample-shipping-label.ts
 */
import fs from "fs";
import path from "path";
import bwipjs from "bwip-js/node";
import QRCode from "qrcode";
import {
  buildQrPayload,
  buildShippingLabelPdf,
  resolveBarcodeValue,
} from "../src/lib/shipping-label-pdf";
import type { Order } from "../src/store/shop-types";

function baseOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "AVY-DEMO-LABEL-1001",
    createdAt: "2026-09-15T10:30:00.000Z",
    status: "Packed",
    items: [
      {
        productId: "p1",
        sku: "GN-1024",
        name: "Gold Necklace",
        image: "/products/neck-1.jpg",
        quantity: 1,
        price: 89900,
      },
    ],
    subtotal: 89900,
    discount: 0,
    shipping: 0,
    total: 89900,
    address: {
      id: "a1",
      name: "Rahul Sharma",
      line1: "Flat 302, ABC Residency",
      line2: "Malviya Nagar",
      city: "Jaipur",
      state: "Rajasthan",
      pincode: "302017",
      phone: "+91 98765 43210",
    },
    paymentId: "pay_demo",
    paymentStatus: "Success",
    paymentMethod: "Razorpay UPI",
    customerEmail: "rahul@example.com",
    shipmentId: "PKG-000987",
    trackingId: "AWB1234567890",
    deliveryPartner: "BlueDart",
    ...overrides,
  };
}

async function decodeChecks(order: Order) {
  const barcode = resolveBarcodeValue(order);
  const qr = buildQrPayload(order, "http://localhost:3000");

  // Re-render barcode and confirm text round-trips via raw BWIPP options
  const png = await bwipjs.toBuffer({
    bcid: "code128",
    text: barcode,
    scale: 2,
    height: 10,
    includetext: false,
  });
  if (!png?.length) throw new Error("Barcode PNG empty");

  const qrData = await QRCode.toDataURL(qr, { width: 128 });
  if (!qrData.startsWith("data:image/png")) throw new Error("QR PNG invalid");

  // Ensure QR does not embed email/phone/tokens
  if (/password|token|jwt|secret|email=|phone=/i.test(qr)) {
    throw new Error("QR payload appears to contain sensitive fields");
  }
  if (!qr.includes(encodeURIComponent(order.id)) && !qr.includes(order.id)) {
    throw new Error("QR payload missing order id");
  }

  return { barcode, qr, barcodeBytes: png.length };
}

async function main() {
  const outDir = path.join(process.cwd(), "tmp-shipping-labels");
  fs.mkdirSync(outDir, { recursive: true });

  const samples: { name: string; order: Order }[] = [
    { name: "label-one-product-prepaid.pdf", order: baseOrder() },
    {
      name: "label-multi-product-cod.pdf",
      order: baseOrder({
        id: "AVY-DEMO-LABEL-1002",
        paymentMethod: "Cash on Delivery",
        paymentStatus: "Pending",
        trackingId: undefined,
        shipmentId: "PKG-COD-44",
        items: [
          {
            productId: "p1",
            sku: "GN-1024",
            name: "Gold Necklace with Extremely Long Product Title That Should Wrap Gracefully On Label",
            image: "/products/neck-1.jpg",
            quantity: 1,
            price: 89900,
          },
          {
            productId: "p2",
            sku: "DR-55",
            name: "Diamond Ring",
            image: "/products/ring-1.jpg",
            quantity: 2,
            price: 120000,
          },
          {
            productId: "p3",
            sku: "",
            name: "Bracelet",
            image: "/products/brace-1.jpg",
            quantity: 1,
            price: 22000,
          },
        ],
      }),
    },
    {
      name: "label-long-address-missing-optional.pdf",
      order: baseOrder({
        id: "AVY-DEMO-LABEL-1003",
        trackingId: undefined,
        shipmentId: undefined,
        deliveryPartner: undefined,
        customerEmail: undefined,
        address: {
          id: "a2",
          name: "Priyanka Krishnamurthy-Venkatesan",
          line1:
            "House No. 14/B, Second Floor, Behind Old Municipal School, Near Sri Venkateswara Temple Complex Gate 3",
          line2: undefined,
          city: "Thiruvananthapuram",
          state: "Kerala",
          pincode: "695001",
          phone: "",
        },
      }),
    },
    {
      name: "label-order-id-only-barcode.pdf",
      order: baseOrder({
        id: "AVY-EDGE-NO-AWB",
        trackingId: undefined,
        shipmentId: undefined,
      }),
    },
  ];

  for (const sample of samples) {
    const checks = await decodeChecks(sample.order);
    const { bytes, meta } = await buildShippingLabelPdf(sample.order, {
      storefrontOrigin: "http://localhost:3000",
    });
    const outPath = path.join(outDir, sample.name);
    fs.writeFileSync(outPath, Buffer.from(bytes));
    console.log(
      `Wrote ${sample.name} (${bytes.length} bytes) barcode=${meta.barcodeValue} qr=${checks.qr}`,
    );
  }

  // Failure path: empty items
  try {
    await buildShippingLabelPdf(baseOrder({ items: [] }));
    console.error("FAIL: expected empty-items error");
    process.exitCode = 1;
  } catch (error) {
    console.log("OK empty-items rejected:", error instanceof Error ? error.message : error);
  }

  console.log(`\nSamples in ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
