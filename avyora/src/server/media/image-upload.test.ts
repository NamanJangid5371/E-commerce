import { describe, expect, it } from "vitest";
import {
  buildSafeImageFilename,
  isAllowedImageMime,
  sanitizeUploadFolder,
  sniffImageMime,
  validateImageUpload,
} from "@/server/media/image-upload";

function jpegBuffer(): Buffer {
  // Minimal SOI + APP0-ish marker bytes enough for our sniffer
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
}

function pngBuffer(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
}

describe("image upload allowlist", () => {
  it("allows only jpeg/png/webp/gif MIME types", () => {
    expect(isAllowedImageMime("image/jpeg")).toBe(true);
    expect(isAllowedImageMime("image/png")).toBe(true);
    expect(isAllowedImageMime("image/webp")).toBe(true);
    expect(isAllowedImageMime("image/gif")).toBe(true);
    expect(isAllowedImageMime("image/svg+xml")).toBe(false);
    expect(isAllowedImageMime("application/octet-stream")).toBe(false);
  });

  it("sniffs jpeg and png magic bytes", () => {
    expect(sniffImageMime(jpegBuffer())).toBe("image/jpeg");
    expect(sniffImageMime(pngBuffer())).toBe("image/png");
    expect(sniffImageMime(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBe(
      null,
    );
  });

  it("rejects SVG even if declared as image/*", () => {
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    const result = validateImageUpload({
      declaredMime: "image/svg+xml",
      filename: "x.svg",
      size: svg.length,
      buffer: svg,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects MIME/content mismatch", () => {
    const result = validateImageUpload({
      declaredMime: "image/png",
      filename: "photo.png",
      size: jpegBuffer().length,
      buffer: jpegBuffer(),
    });
    expect(result.ok).toBe(false);
  });

  it("accepts matching jpeg upload", () => {
    const buf = jpegBuffer();
    const result = validateImageUpload({
      declaredMime: "image/jpeg",
      filename: "photo.jpg",
      size: buf.length,
      buffer: buf,
    });
    expect(result).toEqual({ ok: true, mime: "image/jpeg", extension: "jpg" });
  });

  it("builds unique safe filenames", () => {
    const a = buildSafeImageFilename("jpg", "Ring Photo!.JPG");
    const b = buildSafeImageFilename("jpg", "Ring Photo!.JPG");
    expect(a).toMatch(/^[a-z0-9]+-[a-f0-9]{8}-[a-f0-9]{12}\.jpg$/);
    expect(a).not.toBe(b);
  });

  it("sanitizes upload folders", () => {
    expect(sanitizeUploadFolder("../etc")).toBe("avyora");
    expect(sanitizeUploadFolder("Products/Rings")).toBe("products/rings");
    expect(sanitizeUploadFolder("")).toBe("avyora");
  });
});
