# Avyora — Media Pipeline (Cloudinary)

**Last updated:** 2026-08-31

Product images, banners, and review photos are uploaded through a server-side pipeline. Cloudinary is the production target; local disk is the development fallback.

---

## Environment variables

Add to `avyora/.env`:

```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

| Variable | Exposure | Purpose |
|----------|----------|---------|
| `CLOUDINARY_CLOUD_NAME` | Can be public | URL generation |
| `CLOUDINARY_API_KEY` | Server / signed uploads | Upload authentication |
| `CLOUDINARY_API_SECRET` | **Server only** | Signed uploads, delete, admin transforms |

**Never** expose `CLOUDINARY_API_SECRET` to the browser. Uploads go through `POST /api/media/upload` on the server.

When all three vars are empty, uploads fall back to **local storage** under `public/uploads/`.

---

## Cloudinary setup

1. Create account at [cloudinary.com](https://cloudinary.com).
2. Dashboard → **Account Details** — copy cloud name, API key, API secret.
3. Optional: create upload presets or folder structure:
   - `avyora/products/`
   - `avyora/banners/`
   - `avyora/reviews/`

---

## Upload endpoint

### `POST /api/media/upload`

| | |
|---|---|
| **Auth** | Staff session with `MEDIA_MANAGE` permission (or admin) |
| **Content-Type** | `multipart/form-data` |
| **Fields** | `file` (required, image, max 8MB), `folder` (optional, default `avyora`) |

**Success response:**

```json
{
  "ok": true,
  "data": {
    "url": "https://res.cloudinary.com/…/image/upload/…",
    "publicId": "avyora/products/…",
    "local": false
  }
}
```

**Local fallback response** (`local: true`):

```json
{
  "ok": true,
  "data": {
    "url": "/uploads/avyora/1234567890-photo.jpg",
    "publicId": null,
    "local": true
  }
}
```

**Errors:** 401 unauthenticated, 403 insufficient permissions, 400 invalid file type/size.

---

## Local fallback behaviour

Implemented in `src/server/media/cloudinary.ts`:

1. If Cloudinary credentials are configured → upload via Cloudinary SDK.
2. Otherwise → write to `public/uploads/<folder>/` and return a relative URL.

This allows admin product forms and media pages to work without Cloudinary credentials during local development.

---

## Legacy upload route

`POST /api/upload` (no auth) writes directly to `public/products/`. Prefer `/api/media/upload` for new work — it includes auth, size limits, and Cloudinary support.

---

## Image transforms

Use helper functions in `src/server/media/cloudinary.ts` for responsive URLs:

- Thumbnails (PDP gallery)
- Hero images (width-limited, WebP delivery via Cloudinary `f_auto,q_auto`)

Store in the database:

- `url` — canonical delivery URL
- `publicId` — for transforms and deletion
- `width`, `height`, `format` — when available from upload response

---

## Folder organisation

| Folder | Use |
|--------|-----|
| `avyora/products/` | Product gallery images |
| `avyora/banners/` | Homepage / campaign banners |
| `avyora/reviews/` | Customer review photos |

Pass `folder` in the upload form field to override the default.

---

## Security

- Auth required on `/api/media/upload`
- Images only (`image/*` MIME type)
- 8MB max file size
- Filenames sanitized before local write
- API secret never sent to client — signed uploads only

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Upload returns `local: true` in production | Set all three `CLOUDINARY_*` env vars |
| 403 on upload | Staff login required; role needs `MEDIA_MANAGE` |
| 400 file type | Only images accepted |
| Broken image URLs after deploy | Local fallback URLs are not portable — migrate to Cloudinary for production |
