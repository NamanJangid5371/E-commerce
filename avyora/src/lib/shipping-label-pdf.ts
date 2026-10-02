import bwipjs from "bwip-js/node";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { isCodPaymentMethod } from "@/lib/payment-method";
import { SHIPPING_LABEL } from "@/lib/shipping-label-config";
import type { Order } from "@/store/shop-types";

export type ShippingLabelOptions = {
  /** Public storefront origin used for QR track URL (no secrets). */
  storefrontOrigin?: string;
  /** Override label size (mm). Defaults to SHIPPING_LABEL config. */
  widthMm?: number;
  heightMm?: number;
};

export type ShippingLabelMeta = {
  barcodeValue: string;
  qrPayload: string;
  paymentLabel: string;
  packageId: string | null;
  trackingId: string | null;
};

function storefrontOrigin(override?: string): string {
  const raw =
    override?.trim() ||
    process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN?.trim() ||
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

/** Prefer AWB/tracking → shipment/package → order id. Never encode PII. */
export function resolveBarcodeValue(order: Order): string {
  const candidates = [order.trackingId, order.shipmentId, order.id];
  for (const raw of candidates) {
    const value = sanitizeCode128(raw);
    if (value) return value;
  }
  throw new Error("Cannot generate barcode: order has no usable identifier.");
}

export function buildQrPayload(order: Order, origin?: string): string {
  // Prefills order id on the public track form; email is still required (no PII leak).
  return `${storefrontOrigin(origin)}/track?order=${encodeURIComponent(order.id)}`;
}

export function paymentLabel(order: Order): string {
  if (isCodPaymentMethod(order.paymentMethod)) return "COD";
  if (order.paymentStatus === "Pending") return "PENDING";
  return "PREPAID";
}

function sanitizeCode128(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .trim()
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, 48);
  return cleaned.length > 0 ? cleaned : null;
}

function wrapLines(doc: jsPDF, text: string, maxWidth: number, fontSize: number): string[] {
  doc.setFontSize(fontSize);
  return doc.splitTextToSize(text || "—", maxWidth) as string[];
}

async function code128Png(text: string): Promise<Buffer> {
  try {
    return await bwipjs.toBuffer({
      bcid: "code128",
      text,
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: "center",
      textsize: 9,
      paddingwidth: 6,
      paddingheight: 2,
      backgroundcolor: "FFFFFF",
      barcolor: "000000",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Barcode generation failed";
    throw new Error(`Barcode generation failed: ${message}`);
  }
}

async function qrPng(payload: string): Promise<Buffer> {
  try {
    const dataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
      color: { dark: "#000000", light: "#FFFFFF" },
    });
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    return Buffer.from(base64, "base64");
  } catch (error) {
    const message = error instanceof Error ? error.message : "QR generation failed";
    throw new Error(`QR generation failed: ${message}`);
  }
}

function drawRule(doc: jsPDF, x: number, y: number, w: number) {
  doc.setDrawColor(0);
  doc.setLineWidth(0.25);
  doc.line(x, y, x + w, y);
}

function assertLabelOrder(order: Order) {
  if (!order?.id?.trim()) {
    throw new Error("Cannot generate label: missing order id.");
  }
  if (!order.address?.name?.trim() && !order.address?.line1?.trim()) {
    throw new Error("Cannot generate label: shipping address is incomplete.");
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new Error("Cannot generate label: order has no products.");
  }
}

async function drawShippingLabelPage(
  doc: jsPDF,
  order: Order,
  options: ShippingLabelOptions,
  widthMm: number,
  heightMm: number,
): Promise<ShippingLabelMeta> {
  assertLabelOrder(order);

  const margin = SHIPPING_LABEL.marginMm;
  const contentW = widthMm - margin * 2;

  const barcodeValue = resolveBarcodeValue(order);
  const qrPayload = buildQrPayload(order, options.storefrontOrigin);
  const pay = paymentLabel(order);
  const packageId = order.shipmentId?.trim() || null;
  const trackingId = order.trackingId?.trim() || null;

  const [barcodeBuf, qrBuf] = await Promise.all([code128Png(barcodeValue), qrPng(qrPayload)]);

  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, widthMm, heightMm, "F");

  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("SHIPPING LABEL", widthMm / 2, y + 3.5, { align: "center" });
  y += 7;
  drawRule(doc, margin, y, contentW);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  const metaLines = [
    `ORDER: ${order.id}`,
    packageId ? `PACKAGE: ${packageId}` : null,
    trackingId ? `AWB / TRACKING: ${trackingId}` : null,
    order.deliveryPartner?.trim() ? `COURIER: ${order.deliveryPartner.trim()}` : null,
    `PAYMENT: ${pay}`,
  ].filter(Boolean) as string[];

  for (const line of metaLines) {
    const wrapped = wrapLines(doc, line, contentW, 8);
    for (const w of wrapped) {
      doc.text(w, margin, y);
      y += 3.6;
    }
  }
  y += 1.5;
  drawRule(doc, margin, y, contentW);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("SHIP TO", margin, y);
  y += 4.2;

  const addr = order.address;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const nameLines = wrapLines(doc, addr.name?.trim() || "Customer", contentW, 10);
  for (const line of nameLines) {
    doc.text(line, margin, y);
    y += 4.2;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const addressParts = [
    addr.line1?.trim(),
    addr.line2?.trim(),
    [addr.city?.trim(), addr.state?.trim()].filter(Boolean).join(", ") +
      (addr.pincode?.trim() ? ` - ${addr.pincode.trim()}` : ""),
    "India",
    addr.phone?.trim() ? `Phone: ${addr.phone.trim()}` : null,
  ].filter((part): part is string => Boolean(part && part.replace(/[,\s-]/g, "").length > 0));

  for (const part of addressParts) {
    const wrapped = wrapLines(doc, part, contentW, 8.5);
    for (const line of wrapped) {
      if (y > heightMm - 62) break;
      doc.text(line, margin, y);
      y += 3.7;
    }
  }

  y += 1.5;
  drawRule(doc, margin, y, contentW);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(order.items.length > 1 ? "PRODUCTS" : "PRODUCT", margin, y);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  const maxItems = SHIPPING_LABEL.maxProductLines;
  const visible = order.items.slice(0, maxItems);
  visible.forEach((item, index) => {
    if (y > heightMm - 48) return;
    const prefix = order.items.length > 1 ? `${index + 1}. ` : "";
    const title = `${prefix}${item.name || "Item"} — Qty ${item.quantity}`;
    const titleLines = wrapLines(doc, title, contentW, 7.5);
    for (const line of titleLines.slice(0, 2)) {
      doc.text(line, margin, y);
      y += 3.3;
    }
    if (item.sku?.trim()) {
      doc.setFontSize(7);
      doc.text(`SKU: ${item.sku.trim()}`, margin + (order.items.length > 1 ? 3 : 0), y);
      y += 3.1;
      doc.setFontSize(7.5);
    }
  });
  if (order.items.length > maxItems) {
    doc.setFont("helvetica", "italic");
    doc.text(`+${order.items.length - maxItems} more item(s)`, margin, y);
    y += 3.5;
    doc.setFont("helvetica", "normal");
  }

  const codesTop = Math.max(y + 2, heightMm - 48);
  drawRule(doc, margin, codesTop, contentW);

  const barcodeW = contentW * 0.62;
  const barcodeH = 22;
  const qrSize = 28;
  const barcodeX = margin;
  const barcodeY = codesTop + 3;
  const qrX = widthMm - margin - qrSize;
  const qrY = codesTop + 4;

  doc.addImage(
    `data:image/png;base64,${barcodeBuf.toString("base64")}`,
    "PNG",
    barcodeX,
    barcodeY,
    barcodeW,
    barcodeH,
    undefined,
    "FAST",
  );

  doc.addImage(
    `data:image/png;base64,${qrBuf.toString("base64")}`,
    "PNG",
    qrX,
    qrY,
    qrSize,
    qrSize,
    undefined,
    "FAST",
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.text("SCAN QR → TRACK", qrX + qrSize / 2, qrY + qrSize + 3, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  const pin = addr.pincode?.trim() || "—";
  const city = addr.city?.trim() || "—";
  doc.text(
    `VERIFY: ${order.id} · ${addr.name?.trim() || "—"} · ${city} ${pin}`,
    margin,
    heightMm - margin + 0.5,
  );

  return {
    barcodeValue,
    qrPayload,
    paymentLabel: pay,
    packageId,
    trackingId,
  };
}

/**
 * Builds a black-and-white thermal sticky shipping label PDF.
 * Dimensions default to configured 100×150 mm (override via options / env).
 */
export async function buildShippingLabelPdf(
  order: Order,
  options: ShippingLabelOptions = {},
): Promise<{ bytes: Uint8Array; meta: ShippingLabelMeta }> {
  const widthMm = options.widthMm ?? SHIPPING_LABEL.widthMm;
  const heightMm = options.heightMm ?? SHIPPING_LABEL.heightMm;

  const doc = new jsPDF({
    orientation: heightMm >= widthMm ? "portrait" : "landscape",
    unit: "mm",
    format: [widthMm, heightMm],
    compress: true,
  });

  const meta = await drawShippingLabelPage(doc, order, options, widthMm, heightMm);
  const bytes = doc.output("arraybuffer");
  return {
    bytes: new Uint8Array(bytes),
    meta,
  };
}

export type BulkLabelSkip = { orderId: string; reason: string };

/**
 * Multi-page PDF: one 100×150 mm label page per eligible order.
 */
export async function buildBulkShippingLabelPdf(
  orders: Order[],
  options: ShippingLabelOptions = {},
): Promise<{
  bytes: Uint8Array;
  included: { orderId: string; meta: ShippingLabelMeta }[];
  skipped: BulkLabelSkip[];
}> {
  const widthMm = options.widthMm ?? SHIPPING_LABEL.widthMm;
  const heightMm = options.heightMm ?? SHIPPING_LABEL.heightMm;
  const included: { orderId: string; meta: ShippingLabelMeta }[] = [];
  const skipped: BulkLabelSkip[] = [];

  let doc: jsPDF | null = null;

  for (const order of orders) {
    try {
      if (!doc) {
        doc = new jsPDF({
          orientation: heightMm >= widthMm ? "portrait" : "landscape",
          unit: "mm",
          format: [widthMm, heightMm],
          compress: true,
        });
      } else {
        doc.addPage([widthMm, heightMm], heightMm >= widthMm ? "portrait" : "landscape");
      }
      const meta = await drawShippingLabelPage(doc, order, options, widthMm, heightMm);
      included.push({ orderId: order.id, meta });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Label generation failed";
      skipped.push({ orderId: order.id, reason });
      if (doc) {
        const pageCount = doc.getNumberOfPages();
        if (included.length < pageCount) {
          doc.deletePage(pageCount);
        }
        if (included.length === 0) {
          doc = null;
        }
      }
    }
  }

  if (!doc || included.length === 0) {
    throw new Error(
      skipped.length
        ? `No labels generated. ${skipped.map((s) => `${s.orderId}: ${s.reason}`).join("; ")}`
        : "No orders provided for bulk labels.",
    );
  }

  const bytes = doc.output("arraybuffer");
  return {
    bytes: new Uint8Array(bytes),
    included,
    skipped,
  };
}

export function shippingLabelFilename(orderId: string): string {
  const safe = orderId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 64);
  return `shipping-label-${safe}.pdf`;
}

export function bulkShippingLabelFilename(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `shipping-labels-bulk-${stamp}.pdf`;
}
