import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { hasPermission, PERMISSIONS } from "@/server/auth/permissions";
import { getSessionFromRequest } from "@/server/auth/rbac";
import {
  buildSafeImageFilename,
  MAX_IMAGE_UPLOAD_BYTES,
  validateImageUpload,
} from "@/server/media/image-upload";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const allowed = hasPermission(session.permissions, PERMISSIONS.MEDIA_MANAGE);
  if (!allowed) {
    return NextResponse.json({ error: "Insufficient permissions." }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
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
    return NextResponse.json({ error: validated.message }, { status: 400 });
  }

  const filename = buildSafeImageFilename(validated.extension, file.name);
  const dir = path.join(process.cwd(), "public", "products");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), buffer);

  return NextResponse.json({ url: `/products/${filename}` });
}
