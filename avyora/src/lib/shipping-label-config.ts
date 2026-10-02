/**
 * Thermal / sticky shipping label dimensions.
 * Default: 100 × 150 mm (common 4×6-style logistics sticker in metric).
 * Override via env without code changes:
 *   SHIPPING_LABEL_WIDTH_MM / SHIPPING_LABEL_HEIGHT_MM
 */

function parseMm(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 20 && n < 400 ? n : fallback;
}

export const SHIPPING_LABEL = {
  /** Label width in millimetres */
  widthMm: parseMm(process.env.SHIPPING_LABEL_WIDTH_MM, 100),
  /** Label height in millimetres */
  heightMm: parseMm(process.env.SHIPPING_LABEL_HEIGHT_MM, 150),
  /** Inner margin from sticker edge */
  marginMm: 3.5,
  /** Quiet zone guidance for barcode (mm) */
  barcodeQuietMm: 2,
  /** Max product lines shown on a single sticker */
  maxProductLines: 6,
} as const;

export type ShippingLabelSize = {
  widthMm: number;
  heightMm: number;
  marginMm: number;
};
