import { createClient } from "@supabase/supabase-js";

/**
 * Avatar storage.
 *
 * Supabase Storage rather than a second provider (KTD3): one integration
 * covers both the scrobble store and the upload, and the free tier is far
 * beyond what a single avatar needs.
 */

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
]);

export class UploadRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejected";
  }
}

/**
 * Rejects anything that is not a small image.
 *
 * An over-large upload is refused outright rather than truncated — a truncated
 * image is a corrupt file that renders as a broken avatar with no error
 * anywhere to explain it.
 */
export function validateAvatar(file: { type: string; size: number }): void {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new UploadRejected(
      `Unsupported file type: ${file.type || "unknown"}. Upload a PNG, JPEG, WebP, AVIF or GIF.`,
    );
  }
  if (file.size <= 0) {
    throw new UploadRejected("File is empty.");
  }
  if (file.size > AVATAR_MAX_BYTES) {
    throw new UploadRejected(
      `File is ${(file.size / 1024 / 1024).toFixed(1)}MB; the limit is ${
        AVATAR_MAX_BYTES / 1024 / 1024
      }MB.`,
    );
  }
}

function bucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET || "site-assets";
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new UploadRejected(
      "Supabase Storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

/**
 * Stores the avatar and returns its object path.
 *
 * The path carries a timestamp so a replacement is a new object rather than an
 * overwrite — CDN caches serve the old bytes for a long time otherwise, and
 * the owner sees their previous avatar after a successful upload.
 */
export async function uploadAvatar(
  file: Blob & { type: string; size: number },
  now = Date.now(),
): Promise<string> {
  validateAvatar(file);

  const path = `avatar/${now}.${EXTENSIONS[file.type] ?? "bin"}`;
  const client = serviceClient();

  const { error } = await client.storage
    .from(bucket())
    .upload(path, file, { contentType: file.type, upsert: true });

  if (error) throw new UploadRejected(`Upload failed: ${error.message}`);

  return path;
}

/** Resolves a stored object path to a public URL, or null when unset. */
export function publicAvatarUrl(path: string | null): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${bucket()}/${path}`;
}
