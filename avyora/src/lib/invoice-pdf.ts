import { jsPDF } from "jspdf";
import type { Product } from "@/data/types";
import { site } from "@/data/content";
import { BRAND_LOGO_SRC } from "@/lib/brand";
import type { Order } from "@/store/shop-types";

export const ORDER_FLOW: Order["status"][] = [
  "Pending Payment",
  "Confirmed",
  "Processing",
  "Packed",
  "Ready to Ship",
  "Shipped",
  "In Transit",
  "Out for Delivery",
  "Delivered",
];

/** Post-delivery return / refund path shown on account order cards. */
export const RETURN_FLOW: Order["status"][] = [
  "Delivered",
  "Return Requested",
  "Return Pickup",
  "Returned",
  "Refunded",
];

export function orderStatusStep(status: Order["status"]) {
  if (status === "Cancelled" || status === "Refunded") return -1;
  if (status === "Return Requested" || status === "Return Pickup" || status === "Returned" || status === "RTO") {
    return ORDER_FLOW.indexOf("Delivered");
  }
  if (status === "Failed Delivery") return ORDER_FLOW.indexOf("Out for Delivery");
  return ORDER_FLOW.indexOf(status);
}

export function returnStatusStep(status: Order["status"]) {
  if (status === "RTO") return RETURN_FLOW.indexOf("Returned");
  if (status === "Cancelled") return -1;
  return RETURN_FLOW.indexOf(status);
}

export function isReturnLikeStatus(status: Order["status"]) {
  return (
    status === "Return Requested" ||
    status === "Return Pickup" ||
    status === "Returned" ||
    status === "Refunded" ||
    status === "RTO"
  );
}

export type InvoiceStoreInfo = {
  name?: string;
  tagline?: string;
  email?: string;
  phone?: string;
  address?: string;
  taxPercent?: number;
  returnDays?: number;
  freeShippingMin?: number;
};

export type InvoiceOptions = {
  customerName?: string;
  catalog?: Product[];
  store?: InvoiceStoreInfo;
};

/* ── Layout (A4 points) ─────────────────────────────────────────────────── */

const PAGE = { w: 595.28, h: 841.89 };
const MARGIN = { left: 40, right: 40, top: 36, bottom: 72 };
const CONTENT_W = PAGE.w - MARGIN.left - MARGIN.right;
const LOGO = 44;
const COLORS = {
  cream: [250, 246, 238] as const,
  paper: [255, 252, 248] as const,
  gold: [176, 141, 87] as const,
  goldDeep: [120, 90, 52] as const,
  goldSoft: [236, 226, 208] as const,
  ink: [42, 23, 21] as const,
  soft: [107, 82, 78] as const,
  line: [210, 198, 178] as const,
  white: [255, 255, 255] as const,
  headerBg: [245, 236, 220] as const,
};

/** Fixed table columns — widths sum to CONTENT_W */
const COL = {
  idx: { x: 0, w: 22, align: "center" as const },
  product: { x: 22, w: 228, align: "left" as const },
  qty: { x: 250, w: 44, align: "center" as const },
  unit: { x: 294, w: 112, align: "right" as const },
  total: { x: 406, w: CONTENT_W - 406, align: "right" as const },
};

const FONT = {
  title: 20,
  h2: 11,
  body: 9,
  small: 8,
  table: 8,
  micro: 7,
};

let cachedLogoDataUrl: string | null | undefined;

async function loadAvyoraLogoDataUrl(): Promise<string | null> {
  if (cachedLogoDataUrl !== undefined) return cachedLogoDataUrl;

  try {
    if (typeof window === "undefined") {
      const [{ default: fs }, { default: path }] = await Promise.all([import("fs"), import("path")]);
      const filePath = path.join(process.cwd(), "public", "brand", "avyora-logo.jpg");
      const buf = fs.readFileSync(filePath);
      cachedLogoDataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
      return cachedLogoDataUrl;
    }

    const res = await fetch(BRAND_LOGO_SRC);
    if (!res.ok) throw new Error(`Logo HTTP ${res.status}`);
    const blob = await res.blob();
    cachedLogoDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("Could not read logo"));
      reader.readAsDataURL(blob);
    });
    return cachedLogoDataUrl;
  } catch {
    cachedLogoDataUrl = null;
    return null;
  }
}

function rgb(doc: jsPDF, c: readonly [number, number, number]) {
  doc.setTextColor(c[0], c[1], c[2]);
}

function fill(doc: jsPDF, c: readonly [number, number, number]) {
  doc.setFillColor(c[0], c[1], c[2]);
}

function stroke(doc: jsPDF, c: readonly [number, number, number]) {
  doc.setDrawColor(c[0], c[1], c[2]);
}

/** PDF-safe money: Helvetica has no ₹, which otherwise renders as a broken glyph. */
function money(n: number) {
  const amount = Number.isFinite(n) ? n : 0;
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `Rs. ${formatted}`;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function paymentBadge(order: Order): { label: string; paid: boolean } {
  const status = order.paymentStatus;
  if (status === "Success") return { label: "PAID", paid: true };
  if (status === "Refunded") return { label: "REFUNDED", paid: false };
  if (status === "Cancelled") return { label: "CANCELLED", paid: false };
  if (status === "Failed") return { label: "FAILED", paid: false };
  if (order.status === "Cancelled") return { label: "CANCELLED", paid: false };
  if (order.paymentMethod?.toLowerCase().includes("cash") || status === "Pending") {
    return { label: "PENDING", paid: false };
  }
  return { label: (status as string | undefined)?.toUpperCase() ?? "RECORDED", paid: status === "Success" };
}

function resolveStore(store?: InvoiceStoreInfo) {
  return {
    name: store?.name?.trim() || site.name,
    tagline: store?.tagline?.trim() || site.tagline,
    email: store?.email?.trim() || site.email,
    phone: store?.phone?.trim() || site.phone,
    address: store?.address?.trim() || site.address,
    taxPercent: store?.taxPercent ?? 3,
    returnDays: store?.returnDays ?? 15,
    freeShippingMin: store?.freeShippingMin ?? 7999,
  };
}

function productMeta(order: Order, item: Order["items"][0], catalog?: Product[]) {
  const product = catalog?.find((p) => p.id === item.productId);
  const variant = product?.variants.find((v) => v.sku === item.sku);
  const lines: string[] = [];
  const metal = variant?.metal ?? product?.metal;
  const purity = variant?.purity ?? product?.purity;
  const colour = variant?.colour ?? product?.colour;
  if (metal && purity) lines.push(`${metal} · ${purity}${colour ? ` · ${colour}` : ""}`);
  else if (metal) lines.push(`Metal: ${metal}`);
  if (product?.stone) lines.push(`Stone: ${product.stone}`);
  if (variant?.size) lines.push(`Size: ${variant.size}`);
  if (product?.certificateNumber) lines.push(`Cert: ${product.certificateNumber}`);
  if (!lines.length && product?.category) lines.push(product.category);
  lines.push(`SKU: ${item.sku}`);
  return lines;
}

function colAbs(col: { x: number }) {
  return MARGIN.left + col.x;
}

/** Draw text inside a fixed column with padding; numbers use right/center align. */
function cellText(
  doc: jsPDF,
  text: string,
  col: { x: number; w: number; align: "left" | "right" | "center" },
  y: number,
  opts?: { bold?: boolean; size?: number; color?: readonly [number, number, number]; pad?: number },
) {
  const pad = opts?.pad ?? 6;
  const size = opts?.size ?? FONT.table;
  doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
  doc.setFontSize(size);
  rgb(doc, opts?.color ?? COLORS.ink);
  const left = colAbs(col) + pad;
  const right = colAbs(col) + col.w - pad;
  const width = Math.max(8, right - left);
  const align = col.align;
  if (align === "right") {
    doc.text(text, right, y, { align: "right" });
    return 1;
  }
  if (align === "center") {
    doc.text(text, colAbs(col) + col.w / 2, y, { align: "center" });
    return 1;
  }
  const lines = doc.splitTextToSize(text, width) as string[];
  doc.text(lines, left, y);
  return lines.length;
}

function drawPageBackground(doc: jsPDF) {
  fill(doc, COLORS.cream);
  doc.rect(0, 0, PAGE.w, PAGE.h, "F");
  fill(doc, COLORS.gold);
  doc.rect(0, 0, PAGE.w, 3, "F");
}

function drawTableHeader(doc: jsPDF, y: number) {
  const h = 22;
  fill(doc, COLORS.headerBg);
  doc.rect(MARGIN.left, y, CONTENT_W, h, "F");
  stroke(doc, COLORS.line);
  doc.setLineWidth(0.5);
  doc.rect(MARGIN.left, y, CONTENT_W, h, "S");

  const ty = y + 14;
  cellText(doc, "#", COL.idx, ty, { bold: true, size: FONT.micro, color: COLORS.goldDeep });
  cellText(doc, "PRODUCT", COL.product, ty, { bold: true, size: FONT.micro, color: COLORS.goldDeep });
  cellText(doc, "QTY", COL.qty, ty, { bold: true, size: FONT.micro, color: COLORS.goldDeep });
  cellText(doc, "UNIT PRICE", COL.unit, ty, { bold: true, size: FONT.micro, color: COLORS.goldDeep });
  cellText(doc, "LINE TOTAL", COL.total, ty, { bold: true, size: FONT.micro, color: COLORS.goldDeep });
  return y + h;
}

function drawFooter(doc: jsPDF, store: ReturnType<typeof resolveStore>, page: number, pages: number) {
  const y = PAGE.h - MARGIN.bottom + 10;
  stroke(doc, COLORS.line);
  doc.setLineWidth(0.6);
  doc.line(MARGIN.left, y - 8, PAGE.w - MARGIN.right, y - 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT.micro);
  rgb(doc, COLORS.soft);
  doc.text(`${store.name} · ${store.address}`, MARGIN.left, y);
  doc.text(`${store.phone} · ${store.email}`, MARGIN.left, y + 11);
  doc.text("Thank you for shopping with us. Hallmarked jewellery · Insured shipping.", MARGIN.left, y + 22);

  doc.text(`Page ${page} of ${pages}`, PAGE.w - MARGIN.right, y, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT.micro);
  rgb(doc, COLORS.goldDeep);
  doc.text("TAX INVOICE", PAGE.w - MARGIN.right, y + 11, { align: "right" });
}

function renderOrderInvoicePdf(order: Order, options: InvoiceOptions = {}, logoDataUrl?: string | null) {
  const store = resolveStore(options.store);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const invoiceNo = `INV-${order.id}`;
  const billName = options.customerName?.trim() || order.address?.name || "Customer";
  const badge = paymentBadge(order);
  const taxAmount = Number(order.tax ?? 0);
  const items = order.items ?? [];

  drawPageBackground(doc);

  let y = MARGIN.top;

  /* ── Header ───────────────────────────────────────────────────────────── */
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "JPEG", MARGIN.left, y, LOGO, LOGO);
    } catch {
      /* fall through to text brand */
      logoDataUrl = null;
    }
  }

  const brandX = logoDataUrl ? MARGIN.left + LOGO + 12 : MARGIN.left;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT.title);
  rgb(doc, COLORS.ink);
  doc.text(store.name, brandX, y + 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT.small);
  rgb(doc, COLORS.soft);
  doc.text(store.tagline, brandX, y + 32);
  doc.setFontSize(FONT.micro);
  doc.text(store.address, brandX, y + 44);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT.title);
  rgb(doc, COLORS.ink);
  doc.text("INVOICE", PAGE.w - MARGIN.right, y + 18, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT.small);
  rgb(doc, COLORS.soft);
  const metaRight = PAGE.w - MARGIN.right;
  const metaLines: [string, string][] = [
    ["Invoice no.", invoiceNo],
    ["Invoice date", formatDate(order.createdAt)],
    ["Order ID", order.id],
    ["Payment", `${order.paymentMethod || "—"} · ${badge.label}`],
  ];
  metaLines.forEach(([label, value], i) => {
    const my = y + 34 + i * 12;
    doc.setFont("helvetica", "normal");
    rgb(doc, COLORS.soft);
    doc.text(label, metaRight - 150, my);
    doc.setFont("helvetica", "bold");
    rgb(doc, COLORS.ink);
    doc.text(value, metaRight, my, { align: "right" });
  });

  y = Math.max(y + LOGO + 16, y + 34 + metaLines.length * 12 + 8);
  stroke(doc, COLORS.gold);
  doc.setLineWidth(1);
  doc.line(MARGIN.left, y, PAGE.w - MARGIN.right, y);
  y += 18;

  /* ── Bill To / Ship To ────────────────────────────────────────────────── */
  const half = (CONTENT_W - 16) / 2;
  const billX = MARGIN.left;
  const shipX = MARGIN.left + half + 16;
  const boxTop = y;

  const addressBlock = (title: string, x: number, lines: string[]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT.micro);
    rgb(doc, COLORS.goldDeep);
    doc.text(title, x, boxTop);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONT.body);
    rgb(doc, COLORS.ink);
    let yy = boxTop + 14;
    for (const raw of lines) {
      const line = (raw || "").trim();
      if (!line) continue;
      const wrapped = doc.splitTextToSize(line, half - 4) as string[];
      doc.text(wrapped, x, yy);
      yy += wrapped.length * 11;
    }
    return yy;
  };

  const phone = order.address?.phone?.trim();
  const email = order.customerEmail?.trim();
  const line1 = [order.address?.line1, order.address?.line2].filter(Boolean).join(", ");
  const cityLine = [order.address?.city, order.address?.state, order.address?.pincode]
    .filter(Boolean)
    .join(", ");

  const billBottom = addressBlock("BILL TO", billX, [
    billName,
    email ? `Email: ${email}` : "",
    phone ? `Phone: ${phone}` : "",
    line1,
    cityLine,
    "India",
  ]);

  const shipBottom = addressBlock("SHIP TO", shipX, [
    order.address?.name || billName,
    phone ? `Phone: ${phone}` : "",
    line1,
    cityLine,
    "India",
    order.shippingMethodName ? `Method: ${order.shippingMethodName}` : "",
  ]);

  y = Math.max(billBottom, shipBottom) + 16;

  /* ── Items table ──────────────────────────────────────────────────────── */
  const footerReserve = MARGIN.bottom + 8;
  const ensureSpace = (need: number) => {
    if (y + need <= PAGE.h - footerReserve) return;
    doc.addPage();
    drawPageBackground(doc);
    y = MARGIN.top;
    y = drawTableHeader(doc, y);
  };

  y = drawTableHeader(doc, y);

  items.forEach((item, index) => {
    const meta = productMeta(order, item, options.catalog);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT.table);
    const nameLines = doc.splitTextToSize(item.name || "Item", COL.product.w - 12) as string[];
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONT.micro);
    const metaWrapped = meta.flatMap((m) => doc.splitTextToSize(m, COL.product.w - 12) as string[]);
    const textLines = nameLines.length + metaWrapped.length;
    const rowH = Math.max(28, 10 + textLines * 10 + 8);

    ensureSpace(rowH + 4);

    if (index % 2 === 0) {
      fill(doc, COLORS.paper);
      doc.rect(MARGIN.left, y, CONTENT_W, rowH, "F");
    }
    stroke(doc, COLORS.line);
    doc.setLineWidth(0.35);
    doc.line(MARGIN.left, y + rowH, PAGE.w - MARGIN.right, y + rowH);

    const textY = y + 12;
    cellText(doc, String(index + 1), COL.idx, textY, { size: FONT.table, color: COLORS.soft });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT.table);
    rgb(doc, COLORS.ink);
    doc.text(nameLines, colAbs(COL.product) + 6, textY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONT.micro);
    rgb(doc, COLORS.soft);
    doc.text(metaWrapped, colAbs(COL.product) + 6, textY + nameLines.length * 10);

    cellText(doc, String(item.quantity), COL.qty, textY, { size: FONT.table });
    cellText(doc, money(item.price), COL.unit, textY, { size: FONT.table });
    cellText(doc, money(item.price * item.quantity), COL.total, textY, {
      bold: true,
      size: FONT.table,
    });

    y += rowH;
  });

  if (!items.length) {
    ensureSpace(28);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(FONT.body);
    rgb(doc, COLORS.soft);
    doc.text("No line items on this invoice.", MARGIN.left + 8, y + 16);
    y += 28;
  }

  /* ── Totals ───────────────────────────────────────────────────────────── */
  const totalsBlockH = 118;
  ensureSpace(totalsBlockH + 24);
  y += 14;

  // Align with LINE TOTAL column so amounts stack cleanly under the table.
  const totalsRight = colAbs(COL.total) + COL.total.w - 6;
  const totalsLeft = totalsRight - 210;
  const labelX = totalsLeft + 10;
  const valueX = totalsRight - 10;
  const rows: [string, string][] = [
    ["Subtotal", money(order.subtotal ?? 0)],
    [
      order.coupon ? `Discount (${order.coupon})` : "Discount",
      order.discount ? `- ${money(order.discount)}` : money(0),
    ],
    [`Tax (GST ${store.taxPercent}%)`, money(taxAmount)],
    ["Shipping", order.shipping ? money(order.shipping) : "Complimentary"],
  ];

  rows.forEach(([label, value]) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONT.body);
    rgb(doc, COLORS.soft);
    doc.text(label, labelX, y);
    rgb(doc, COLORS.ink);
    doc.text(value, valueX, y, { align: "right" });
    y += 14;
  });

  y += 6;
  const grandH = 28;
  fill(doc, COLORS.gold);
  doc.roundedRect(totalsLeft, y, 210, grandH, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(FONT.h2);
  rgb(doc, COLORS.white);
  const grandY = y + grandH / 2 + 3.5;
  doc.text("Grand Total", labelX, grandY);
  doc.setFontSize(11);
  doc.text(money(order.total ?? 0), valueX, grandY, { align: "right" });
  y += grandH + 16;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(FONT.micro);
  rgb(doc, COLORS.soft);
  const terms = doc.splitTextToSize(
    `${store.returnDays}-day exchange on unworn jewellery with original tags and certificate. Amount charged matches checkout. This document is a tax invoice for your records.`,
    CONTENT_W,
  ) as string[];
  ensureSpace(terms.length * 10 + 20);
  doc.text(terms, MARGIN.left, y);
  y += terms.length * 10 + 8;

  if (order.status === "Cancelled" || order.status === "Refunded") {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONT.small);
    rgb(doc, COLORS.soft);
    doc.text(
      `Status: ${order.status}${order.cancelReason ? ` — ${order.cancelReason}` : ""}`,
      MARGIN.left,
      y,
    );
  }

  /* ── Footers on every page ────────────────────────────────────────────── */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    drawFooter(doc, store, p, pages);
  }

  return doc;
}

function normalizeOptions(customerNameOrOptions?: string | InvoiceOptions): InvoiceOptions {
  return typeof customerNameOrOptions === "string"
    ? { customerName: customerNameOrOptions }
    : customerNameOrOptions ?? {};
}

/** Build invoice PDF bytes for email attachments or server-side delivery. */
export async function buildOrderInvoicePdf(
  order: Order,
  customerNameOrOptions?: string | InvoiceOptions,
): Promise<Buffer> {
  const options = normalizeOptions(customerNameOrOptions);
  const logo = await loadAvyoraLogoDataUrl();
  const doc = renderOrderInvoicePdf(order, options, logo);
  const arrayBuffer = doc.output("arraybuffer") as ArrayBuffer;
  return Buffer.from(arrayBuffer);
}

export async function downloadOrderInvoicePdf(
  order: Order,
  customerNameOrOptions?: string | InvoiceOptions,
) {
  const options = normalizeOptions(customerNameOrOptions);
  const logo = await loadAvyoraLogoDataUrl();
  const doc = renderOrderInvoicePdf(order, options, logo);
  doc.save(`${order.id}-invoice.pdf`);
}
