import { createHash, randomBytes } from "crypto";

export const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Client-declared MIME types we accept (SVG intentionally excluded). */
export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

const MIME_TO_EXT: Record<AllowedImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const EXT_TO_MIME: Record<string, AllowedImageMime> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export type ImageValidationResult =
  | { ok: true; mime: AllowedImageMime; extension: string }
  | { ok: false; message: string };

function normalizeMime(raw: string): string {
  return raw.trim().toLowerCase().split(";")[0]?.trim() ?? "";
}

export function isAllowedImageMime(mime: string): mime is AllowedImageMime {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(normalizeMime(mime));
}

/** Detect image type from magic bytes — never trust client Content-Type alone. */
export function sniffImageMime(buffer: Buffer): AllowedImageMime | null {
  if (buffer.length < 12) return null;

  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // GIF87a / GIF89a
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return "image/gif";
  }

  // WEBP: RIFF....WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

function extensionFromFilename(filename: string): string | null {
  const base = filename.trim().toLowerCase();
  const match = base.match(/\.([a-z0-9]+)$/);
  if (!match) return null;
  const ext = match[1];
  return EXT_TO_MIME[ext] ? ext : null;
}

/**
 * Validate declared MIME, filename extension, size, and magic bytes.
 * Rejects SVG and any mismatched/spoofed types.
 */
export function validateImageUpload(input: {
  declaredMime: string;
  filename: string;
  size: number;
  buffer: Buffer;
  maxBytes?: number;
}): ImageValidationResult {
  const maxBytes = input.maxBytes ?? MAX_IMAGE_UPLOAD_BYTES;

  if (!input.size || input.buffer.length === 0) {
    return { ok: false, message: "No file provided." };
  }
  if (input.size > maxBytes || input.buffer.length > maxBytes) {
    return { ok: false, message: "File exceeds 8MB limit." };
  }

  const declared = normalizeMime(input.declaredMime);
  if (declared === "image/svg+xml" || declared.includes("svg")) {
    return { ok: false, message: "SVG uploads are not allowed." };
  }
  if (!isAllowedImageMime(declared)) {
    return {
      ok: false,
      message: "Only JPEG, PNG, WebP, and GIF images are allowed.",
    };
  }

  const extFromName = extensionFromFilename(input.filename);
  if (extFromName) {
    const mimeFromExt = EXT_TO_MIME[extFromName];
    if (mimeFromExt !== declared) {
      return { ok: false, message: "File extension does not match image type." };
    }
  }

  const sniffed = sniffImageMime(input.buffer);
  if (!sniffed) {
    return { ok: false, message: "File content is not a recognized image." };
  }
  if (sniffed !== declared) {
    return { ok: false, message: "File content does not match declared image type." };
  }

  return {
    ok: true,
    mime: sniffed,
    extension: MIME_TO_EXT[sniffed],
  };
}

/** Unique safe filename derived from sniffed type (ignores original name for storage). */
export function buildSafeImageFilename(extension: string, originalName?: string): string {
  const stamp = Date.now().toString(36);
  const rand = randomBytes(6).toString("hex");
  const hint = originalName
    ? createHash("sha1").update(originalName).digest("hex").slice(0, 8)
    : "img";
  return `${stamp}-${hint}-${rand}.${extension}`;
}

/** Allow only safe Cloudinary folder segments. */
export function sanitizeUploadFolder(folder: string | null | undefined): string {
  const raw = (folder ?? "avyora").trim().toLowerCase();
  if (!raw || raw.includes("..")) return "avyora";
  const cleaned = raw
    .replace(/[^a-z0-9/_-]/g, "")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (!cleaned || cleaned.includes("..")) return "avyora";
  return cleaned.slice(0, 80);
}
