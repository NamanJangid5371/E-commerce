import { hasPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest } from "@/server/auth/rbac";
import { uploadImage } from "@/server/media/cloudinary";
import {
  buildSafeImageFilename,
  MAX_IMAGE_UPLOAD_BYTES,
  sanitizeUploadFolder,
  validateImageUpload,
} from "@/server/media/image-upload";
import {
  dbUnavailableError,
  isDbUnavailable,
  jsonError,
  jsonOk,
} from "@/server/http";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return jsonError("Authentication required.", 401);
    }

    const allowed = hasPermission(session.permissions, PERMISSIONS.MEDIA_MANAGE);
    if (!allowed) {
      return jsonError("Insufficient permissions.", 403);
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const folder = sanitizeUploadFolder((formData.get("folder") as string | null) ?? "avyora");

    if (!(file instanceof File) || !file.size) {
      return jsonError("No file provided.", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const validated = validateImageUpload({
      declaredMime: file.type,
      filename: file.name,
      size: file.size,
      buffer,
      maxBytes: MAX_IMAGE_UPLOAD_BYTES,
    });

    if (!validated.ok) {
      return jsonError(validated.message, 400);
    }

    const safeName = buildSafeImageFilename(validated.extension, file.name);
    const result = await uploadImage(buffer, folder, safeName);

    return jsonOk({
      url: result.url,
      publicId: result.publicId,
      local: result.local ?? false,
    });
  } catch (error) {
    if (isDbUnavailable(error)) {
      return dbUnavailableError();
    }
    logger.error("media.upload.failed", { error: String(error) });
    return jsonError("Could not upload file.", 500);
  }
}
