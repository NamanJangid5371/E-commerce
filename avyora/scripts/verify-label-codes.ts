import fs from "fs";
import path from "path";
import bwipjs from "bwip-js/node";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { PNG } from "pngjs";

async function main() {
  const outDir = path.join(process.cwd(), "tmp-shipping-labels");
  fs.mkdirSync(outDir, { recursive: true });

  const barcodeText = "AWB1234567890";
  const png = await bwipjs.toBuffer({
    bcid: "code128",
    text: barcodeText,
    scale: 4,
    height: 14,
    includetext: true,
    textxalign: "center",
    paddingwidth: 10,
    paddingheight: 4,
    backgroundcolor: "FFFFFF",
    barcolor: "000000",
  });
  const barcodePath = path.join(outDir, "barcode-sample.png");
  fs.writeFileSync(barcodePath, png);
  console.log("barcode bytes", png.length, "dims", png.readUInt32BE(16), "x", png.readUInt32BE(20));

  const qrPayload = "http://localhost:3000/track?order=AVY-DEMO-LABEL-1001";
  const qrPath = path.join(outDir, "qr-sample.png");
  await QRCode.toFile(qrPath, qrPayload, { width: 256, margin: 1, errorCorrectionLevel: "M" });

  // Decode QR from PNG pixels
  const qrPng = PNG.sync.read(fs.readFileSync(qrPath));
  const decoded = jsQR(new Uint8ClampedArray(qrPng.data), qrPng.width, qrPng.height);
  if (!decoded?.data) throw new Error("QR decode failed");
  if (decoded.data !== qrPayload) throw new Error(`QR mismatch: ${decoded.data}`);
  console.log("QR decoded OK:", decoded.data);

  // Confirm barcode human text is present in PNG tEXt or at least buffer non-empty + dimensions
  if (png.readUInt32BE(16) < 100) throw new Error("Barcode too narrow");
  console.log("Barcode PNG looks valid for Code128 text", barcodeText);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
