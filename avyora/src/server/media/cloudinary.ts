import fs from "fs";
import path from "path";
import { v2 as cloudinary } from "cloudinary";

export type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

export type UploadImageResult = {
  url: string;
  publicId: string | null;
  local?: boolean;
};

export type TransformOptions = {
  width?: number;
  height?: number;
  crop?: "fill" | "fit" | "scale" | "thumb" | "crop";
};

let configured = false;

function getCloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim() || "";
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim() || "";
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim() || "";

  if (!cloudName || !apiKey || !apiSecret) return null;

  return { cloudName, apiKey, apiSecret };
}

function ensureCloudinaryConfigured(): boolean {
  const config = getCloudinaryConfig();
  if (!config) return false;

  if (!configured) {
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      secure: true,
    });
    configured = true;
  }

  return true;
}

export function isCloudinaryConfigured(): boolean {
  return getCloudinaryConfig() !== null;
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function uploadImage(
  buffer: Buffer,
  folder: string,
  filename: string,
): Promise<UploadImageResult> {
  const safeFilename = sanitizeFilename(filename);

  if (ensureCloudinaryConfigured()) {
    const publicId = safeFilename.replace(/\.[^.]+$/, "");
    const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: "image",
          overwrite: true,
        },
        (error, uploadResult) => {
          if (error || !uploadResult) {
            reject(error ?? new Error("Cloudinary upload failed"));
            return;
          }
          resolve({
            secure_url: uploadResult.secure_url,
            public_id: uploadResult.public_id,
          });
        },
      );
      stream.end(buffer);
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      local: false,
    };
  }

  const productsDir = path.join(process.cwd(), "public", "products");
  if (!fs.existsSync(productsDir)) {
    fs.mkdirSync(productsDir, { recursive: true });
  }

  // Prefer unique name from caller; never overwrite silently on collision.
  let targetName = safeFilename;
  let targetPath = path.join(productsDir, targetName);
  if (fs.existsSync(targetPath)) {
    const ext = path.extname(safeFilename);
    const stem = path.basename(safeFilename, ext);
    targetName = `${stem}-${Date.now()}${ext}`;
    targetPath = path.join(productsDir, targetName);
  }

  fs.writeFileSync(targetPath, buffer);

  return {
    url: `/products/${targetName}`,
    publicId: null,
    local: true,
  };
}

export async function deleteAsset(publicId: string | null): Promise<void> {
  if (!publicId) return;
  if (!ensureCloudinaryConfigured()) return;

  await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
}

function isCloudinaryUrl(url: string): boolean {
  return /res\.cloudinary\.com/i.test(url);
}

export function transformUrl(url: string, options: TransformOptions): string {
  if (!isCloudinaryUrl(url)) return url;

  const transforms: string[] = [];
  if (options.width) transforms.push(`w_${options.width}`);
  if (options.height) transforms.push(`h_${options.height}`);
  if (options.crop) transforms.push(`c_${options.crop}`);

  if (transforms.length === 0) return url;

  const transformSegment = transforms.join(",");

  const uploadMarker = "/upload/";
  const markerIndex = url.indexOf(uploadMarker);
  if (markerIndex === -1) return url;

  const prefix = url.slice(0, markerIndex + uploadMarker.length);
  const remainder = url.slice(markerIndex + uploadMarker.length);

  if (remainder.startsWith("v") && /\/v\d+\//.test(`${uploadMarker}${remainder}`)) {
    const versionMatch = remainder.match(/^(v\d+\/)(.+)$/);
    if (versionMatch) {
      return `${prefix}${transformSegment}/${versionMatch[1]}${versionMatch[2]}`;
    }
  }

  return `${prefix}${transformSegment}/${remainder}`;
}
