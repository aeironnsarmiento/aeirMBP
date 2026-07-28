import { createClient } from "@supabase/supabase-js";
import {
  ACCEPTED_ASSET_TYPES,
  ASSET_RULES,
  MAX_ASSET_BYTES,
  UploadRejected,
  formatMegabytes,
  validateAsset,
  type AssetKind,
} from "./schema";

/**
 * Asset storage.
 *
 * Supabase Storage rather than a second provider: one integration covers both
 * the scrobble store and the uploads, and the free tier is far beyond what a
 * handful of images needs.
 *
 * Both asset kinds share this module — only the path prefix, the ceiling and
 * the accepted types differ, and all three live in `./schema` so the Settings
 * panel can state the limits it will be held to without importing this file
 * (and, with it, the storage SDK) into the browser bundle.
 */

// Re-exported because the upload handlers catch it to map a rejection onto a
// 422. Everything else imports the asset rules straight from `./schema`, which
// is the module a client component can reach.
export { UploadRejected } from "./schema";

/*
 * Load-bearing beyond tidiness: the stored extension is the only thing that
 * tells the shell whether a background is a still or a video (`kindFor` in
 * lib/theme/backgrounds.ts), because storage hands back a path and not a MIME
 * type. A type missing from this map lands as `.bin` and renders as an image.
 */
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export function bucketName(): string {
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

/**
 * Where a new object of this kind goes.
 *
 * The path carries a timestamp so a replacement is a new object rather than an
 * overwrite — CDN caches serve the old bytes for a long time otherwise, and
 * the owner sees their previous image after a successful upload.
 */
export function assetPath(
  kind: AssetKind,
  contentType: string,
  now = Date.now(),
): string {
  return `${ASSET_RULES[kind].prefix}/${now}.${EXTENSIONS[contentType] ?? "bin"}`;
}

/** True when the path is one this app would have minted for that kind. */
export function isAssetPath(kind: AssetKind, path: string): boolean {
  return new RegExp(`^${ASSET_RULES[kind].prefix}/\\d+\\.[a-z]+$`).test(path);
}

/** Stores an asset through the application server and returns its object path. */
export async function uploadAsset(
  kind: AssetKind,
  file: Blob & { type: string; size: number },
  now = Date.now(),
): Promise<string> {
  validateAsset(kind, file);

  const path = assetPath(kind, file.type, now);
  const client = serviceClient();

  const { error } = await client.storage
    .from(bucketName())
    .upload(path, file, { contentType: file.type, upsert: true });

  if (error) throw new UploadRejected(`Upload failed: ${error.message}`);

  return path;
}

/** The avatar is small enough to keep the simpler server-relayed path. */
export function uploadAvatar(
  file: Blob & { type: string; size: number },
  now = Date.now(),
): Promise<string> {
  return uploadAsset("avatar", file, now);
}

/**
 * Grants the browser permission to write one object, without the bytes passing
 * through this server (R13).
 *
 * The declared size and type are checked before the token is issued, so the
 * ceiling is enforced by the party granting permission rather than by the
 * client that asked for it.
 */
export async function signAssetUpload(
  kind: AssetKind,
  declared: { type: string; size: number },
  now = Date.now(),
): Promise<{ path: string; signedUrl: string; token: string }> {
  validateAsset(kind, declared);

  const path = assetPath(kind, declared.type, now);
  const client = serviceClient();

  const { data, error } = await client.storage
    .from(bucketName())
    .createSignedUploadUrl(path);

  if (error || !data) {
    throw new UploadRejected(
      `Could not start the upload: ${error?.message ?? "no signed URL returned"}.`,
    );
  }

  return { path, signedUrl: data.signedUrl, token: data.token };
}

/* --- Self-check (R18, R19, R20) -------------------------------------------
 *
 * Three configuration faults reached the owner as raw vendor strings before
 * this existed — a publishable key where a service-role secret belonged, then
 * a bucket that was never created. Each is invisible from the site and only
 * the owner can fix it, so storage health is something the site reports on.
 */

export type StorageFault =
  | "credential"
  | "bucket"
  | "visibility"
  | "limit"
  | "types";

export type StorageCheck = {
  ok: boolean;
  fault: StorageFault | null;
  message: string;
};

export type CredentialKind = "missing" | "publishable" | "anon" | "plausible";

/**
 * Classifies the credential without exposing it.
 *
 * The evaluation below never sees the key itself, only this verdict, so no
 * code path can put a secret into a response or a log line.
 */
export function classifyCredential(key: string | undefined): CredentialKind {
  if (!key) return "missing";
  if (key.startsWith("sb_publishable_")) return "publishable";

  // A legacy key is a JWT whose payload names the role it grants.
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const claims = JSON.parse(
        atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
      ) as { role?: string };
      if (claims.role && claims.role !== "service_role") return "anon";
    } catch {
      // Not a readable JWT. Let the storage API be the judge.
    }
  }

  return "plausible";
}

/** Turns a set of observations into the one thing the owner should do next. */
export function evaluateStorage(input: {
  credential: CredentialKind;
  bucket: string;
  found: {
    isPublic: boolean;
    fileSizeLimit: number | null;
    /** Absent or null means the bucket restricts nothing. */
    allowedTypes?: string[] | null;
  } | null;
  requiredBytes: number;
}): StorageCheck {
  const { credential, bucket, found, requiredBytes } = input;

  if (credential === "missing") {
    return {
      ok: false,
      fault: "credential",
      message:
        "No storage credential is set. Add the service-role secret as SUPABASE_SERVICE_ROLE_KEY.",
    };
  }
  if (credential === "publishable" || credential === "anon") {
    return {
      ok: false,
      fault: "credential",
      message:
        "That is a publishable key, not the service-role secret. Uploads will be refused before permissions are ever checked. Copy the service_role secret from the project's API settings.",
    };
  }

  if (!found) {
    return {
      ok: false,
      fault: "bucket",
      message: `No bucket named "${bucket}". Create it in Storage, or point SUPABASE_STORAGE_BUCKET at the one you already have.`,
    };
  }

  if (!found.isPublic) {
    return {
      ok: false,
      fault: "visibility",
      message: `The bucket "${bucket}" is not public. Uploads will succeed and every image will then fail to load, with no error anywhere. Turn on public access.`,
    };
  }

  if (found.fileSizeLimit !== null && found.fileSizeLimit < requiredBytes) {
    return {
      ok: false,
      fault: "limit",
      message: `The bucket "${bucket}" caps files at ${formatMegabytes(found.fileSizeLimit)}, below the ${formatMegabytes(requiredBytes)} this site allows. Raise the bucket's file size limit.`,
    };
  }

  // The bucket's own type list is the only enforcement on the direct-to-storage
  // path: the browser is handed a signed URL and could PUT bytes other than the
  // ones it declared. A list narrower than this site accepts turns some uploads
  // into a storage rejection with nothing to explain it.
  const missing = found.allowedTypes
    ? ACCEPTED_ASSET_TYPES.filter((type) => !found.allowedTypes?.includes(type))
    : [];

  if (missing.length > 0) {
    return {
      ok: false,
      fault: "types",
      message: `The bucket "${bucket}" refuses ${missing.join(", ")}, which this site accepts. Widen the bucket's allowed MIME types.`,
    };
  }

  return {
    ok: true,
    fault: null,
    message: `Storage is usable: "${bucket}" is public and accepts files up to ${
      found.fileSizeLimit === null
        ? "the project default"
        : formatMegabytes(found.fileSizeLimit)
    }.`,
  };
}

/** Runs the probes in order and reports the first fault, not a list of them. */
export async function checkStorage(): Promise<StorageCheck> {
  const credential = classifyCredential(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const bucket = bucketName();
  const requiredBytes = MAX_ASSET_BYTES;

  if (credential !== "plausible" || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return evaluateStorage({
      credential: credential === "plausible" ? "missing" : credential,
      bucket,
      found: null,
      requiredBytes,
    });
  }

  const { data, error } = await serviceClient().storage.getBucket(bucket);

  return evaluateStorage({
    credential,
    bucket,
    found:
      error || !data
        ? null
        : {
            isPublic: data.public,
            fileSizeLimit: data.file_size_limit ?? null,
            allowedTypes: data.allowed_mime_types ?? null,
          },
    requiredBytes,
  });
}

/* --- Repair (R18) ---------------------------------------------------------
 *
 * The check above states what to fix; every fault but one is a bucket setting
 * this app's own credential is allowed to change. Doing it from the Settings
 * panel keeps the owner out of a second vendor dashboard for what is really
 * one-time provisioning of this site's own storage.
 */

export type RepairAction = "create" | "update" | null;

/**
 * What would fix this fault, or null when nothing here can.
 *
 * A credential fault is deliberately not repairable: the secret lives in the
 * deployment's environment, and code holding a bad key cannot mint a good one.
 */
export function repairPlan(check: StorageCheck): RepairAction {
  if (check.ok) return null;
  if (check.fault === "bucket") return "create";
  if (
    check.fault === "visibility" ||
    check.fault === "limit" ||
    check.fault === "types"
  ) {
    return "update";
  }
  return null;
}

/**
 * Brings storage to the shape this site needs, then re-checks.
 *
 * The returned check is the one taken *after* the change, so the panel reports
 * the state that now exists rather than the state that was asked for.
 */
export async function repairStorage(): Promise<StorageCheck> {
  const before = await checkStorage();
  const action = repairPlan(before);
  if (!action) return before;

  const bucket = bucketName();
  const options = {
    public: true,
    fileSizeLimit: MAX_ASSET_BYTES,
    allowedMimeTypes: [...ACCEPTED_ASSET_TYPES],
  };
  const storage = serviceClient().storage;

  const { error } =
    action === "create"
      ? await storage.createBucket(bucket, options)
      : await storage.updateBucket(bucket, options);

  if (error) {
    throw new UploadRejected(
      `Could not ${action === "create" ? "create" : "update"} the bucket "${bucket}": ${error.message}`,
    );
  }

  return checkStorage();
}

/**
 * Removes a stored object.
 *
 * A missing object is not an error: the settings row and the bucket can drift
 * apart — a failed upload, a manual deletion — and the only thing the owner
 * asked for is that it be gone. Reporting "not found" would leave them with a
 * background they cannot clear.
 */
export async function deleteAsset(path: string): Promise<void> {
  const { error } = await serviceClient().storage.from(bucketName()).remove([path]);
  if (error) throw new Error(`Storage refused to delete the file: ${error.message}`);
}

/** Resolves a stored object path to a public URL, or null when unset. */
export function publicAssetUrl(path: string | null): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${bucketName()}/${path}`;
}
