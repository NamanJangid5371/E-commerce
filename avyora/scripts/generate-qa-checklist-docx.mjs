import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType } from "docx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "..", "..", "Avyora-Website-QA-Checklist.docx");

const border = { style: BorderStyle.SINGLE, size: 4, color: "C9B896" };
const borders = { top: border, bottom: border, left: border, right: border };

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 120, before: opts.before ?? 0, line: 276 },
    ...opts,
    children: [
      new TextRun({
        text,
        font: "Calibri",
        size: opts.size ?? 22,
        bold: opts.bold,
        italics: opts.italics,
        color: opts.color,
      }),
    ],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 280, after: 160 },
    children: [new TextRun({ text, font: "Calibri", bold: true, size: 32, color: "2A1715" })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: "Calibri", bold: true, size: 26, color: "5C3A1E" })],
  });
}

function bullet(text) {
  return new Paragraph({
    spacing: { after: 80 },
    indent: { left: 360 },
    children: [new TextRun({ text: `•  ${text}`, font: "Calibri", size: 22 })],
  });
}

function check(text) {
  return new Paragraph({
    spacing: { after: 80 },
    indent: { left: 360 },
    children: [new TextRun({ text: `☐  ${text}`, font: "Calibri", size: 22 })],
  });
}

function cell(text, width, opts = {}) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: opts.header ? { fill: "F5ECDC" } : undefined,
    children: [
      new Paragraph({
        spacing: { after: 60, before: 60 },
        children: [
          new TextRun({
            text,
            font: "Calibri",
            size: 20,
            bold: !!opts.header,
            color: opts.header ? "785C34" : "2A1715",
          }),
        ],
      }),
    ],
  });
}

function table(rows) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3120, 6240],
    rows: rows.map((r, i) =>
      new TableRow({
        children: [cell(r[0], 3120, { header: i === 0 }), cell(r[1], 6240, { header: i === 0 })],
      }),
    ),
  });
}

const doc = new Document({
  styles: {
    default: {
      document: {
        styles: [{ id: "Normal", run: { font: "Calibri", size: 22 } }],
      },
    },
  },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 720, bottom: 720, left: 720, right: 720 },
        },
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [
            new TextRun({ text: "AVYORA", font: "Georgia", bold: true, size: 40, color: "7A251C" }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: "Website QA Checklist — How to Check Everything",
              font: "Calibri",
              size: 28,
              bold: true,
              color: "2A1715",
            }),
          ],
        }),
        p("Manual walkthrough across Store (3000), Admin (3001), and Logistics (3002).", {
          italics: true,
          color: "6B524E",
          after: 200,
        }),
        p(`Generated: ${new Date().toLocaleString("en-IN")}`, { size: 18, color: "6B524E", after: 280 }),

        h1("0. Start everything"),
        p("In a terminal:"),
        p("cd avyora", { bold: true }),
        p("npm run dev:all", { bold: true, after: 160 }),
        p("Then open these URLs:"),
        table([
          ["Portal", "URL"],
          ["Store", "http://localhost:3000"],
          ["Admin", "http://localhost:3001/admin"],
          ["Logistics", "http://localhost:3002/logistics"],
        ]),
        p("", { after: 120 }),
        p("Staff sign-in (use your seeded password from ADMIN_SEED_PASSWORD):"),
        bullet("Admin: http://localhost:3001/staff-login"),
        bullet("Logistics: http://localhost:3002/logistics-login"),
        bullet("Example staff email: admin@avyora.com"),

        h1("1. Storefront — browse & account"),
        bullet("Open http://localhost:3000"),
        bullet("Browse shop → open a product → add to bag"),
        bullet("Open cart → go to checkout"),
        bullet("Create / sign in as a customer (not staff) at http://localhost:3000/login"),
        bullet("Confirm account page loads: http://localhost:3000/account"),

        h1("2. Place an order (COD is easiest locally)"),
        bullet("Checkout with a full address"),
        bullet("Choose COD (avoids Razorpay if keys are not set)"),
        bullet("Place order → note Order ID (e.g. AVY-…)"),
        bullet("Open order page / account → confirm order appears"),
        bullet("Optional: Download invoice PDF → check amounts align (Rs. …, grand total not cut off)"),
        p("Also try (if Razorpay is configured): prepaid checkout → pay → confirm status becomes paid/confirmed.", {
          italics: true,
          after: 120,
        }),

        h1("3. Customer tracking"),
        bullet("Go to http://localhost:3000/track"),
        bullet("Enter Order ID + customer email"),
        bullet("Confirm timeline / status shows"),
        bullet("Wrong email → should NOT show another customer’s order"),
        bullet("Open the same order from Account → Orders and compare status"),

        h1("4. Admin portal"),
        bullet("Login → http://localhost:3001/admin"),
        bullet("Orders — find the new order (view only for shipment)"),
        bullet("Confirm message that shipment updates happen in logistics"),
        bullet("Reports — monthly sales starts Sept; Y-axis up to 1 Cr; tick shows ₹1 Cr not 100L"),
        bullet("Products / inventory / coupons — smoke-check list pages load"),
        bullet("Sign out → reopen /admin → should redirect to staff login"),

        h1("5. Logistics portal — main fulfilment path"),
        bullet("Login → http://localhost:3002/logistics"),
        bullet("Orders → open your new order"),
        bullet("Advance status ONE STEP AT A TIME (system blocks jumps):"),
        p("Confirmed → Processing → Packed → Ready to Ship → Shipped → In Transit → Out for Delivery → Delivered", {
          bold: true,
          after: 160,
        }),
        p("At Packed / Ready to Ship:"),
        bullet("Print / generate shipping label"),
        bullet("Try Print selected labels / Print all new labels"),
        bullet("Set delivery partner, tracking ID, ETA if fields exist"),
        bullet("Add a tracking note (if UI has it)"),
        bullet("Record a delivery attempt (customer unavailable) → may move toward Failed Delivery"),
        bullet("Retry → Out for Delivery → Delivered"),
        bullet("For COD: confirm collect / payment handling after delivery"),

        h1("6. Cross-check after each logistics update"),
        p("After every status change, refresh:"),
        bullet("Logistics order detail — new status + history"),
        bullet("Customer Track page — same status"),
        bullet("Customer Account order — same status"),
        bullet("Admin order detail — reflects progress (view-only)"),

        h1("7. Cancel / return / edge cases"),
        table([
          ["Check", "Steps"],
          ["Customer cancel", "New COD order still early (Pending/Confirmed/Packed) → cancel from account"],
          ["Invalid jump", "In logistics, try Confirmed → Shipped → should reject"],
          ["Terminal lock", "After Delivered/Cancelled/Refunded, further advances should fail"],
          ["Bulk status", "Select several orders → bulk status (only valid transitions)"],
          ["Auth gate", "Open logistics URL logged out → redirect to logistics-login"],
        ]),

        h1("8. Invoice & emails (optional)"),
        bullet("Download invoice again after delivery"),
        bullet("If SMTP is set: confirm order email / status email"),
        bullet("If SMTP is not set: skip — do not treat missing email as a site bug"),

        h1("9. Security smoke checks"),
        bullet("Customer A order ID + Customer B email on /track → no data"),
        bullet("Customer JWT cannot open admin/logistics pages"),
        bullet("Staff cannot use customer-only create client account with staff email (if you test signup)"),

        h1("10. Quick “all green” checklist"),
        check("Store loads products"),
        check("COD order places successfully"),
        check("Track works with correct email"),
        check("Admin sees order"),
        check("Logistics advances status step-by-step"),
        check("Label prints"),
        check("Customer track updates after logistics change"),
        check("Invoice looks aligned"),
        check("Reports Sept / 1 Cr labels OK"),
        check("Logged-out staff portals redirect to login"),

        h1("Notes"),
        bullet("Carrier auto-tracking (Shiprocket webhooks) is not fully wired — do not expect automatic In Transit/OFD without manual logistics updates."),
        bullet("Use COD for local end-to-end if Razorpay is not configured."),
        bullet("Keep one notepad with Order ID + email while jumping between the three ports."),

        p("", { after: 200 }),
        p("End of checklist — Avyora QA", { italics: true, color: "6B524E", size: 18 }),
      ],
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outPath, buffer);
console.log(`Wrote: ${outPath}`);
