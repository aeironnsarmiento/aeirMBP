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

export { UploadRejected } from "./schema";

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

export function assetPath(
  kind: AssetKind,
  contentType: string,
  now = Date.now(),
): string {
  return `${ASSET_RULES[kind].prefix}/${now}.${EXTENSIONS[contentType] ?? "bin"}`;
}

export function isAssetPath(kind: AssetKind, path: string): boolean {
  return new RegExp(`^${ASSET_RULES[kind].prefix}/\\d+\\.[a-z0-9]+$`).test(path);
}

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

export function uploadAvatar(
  file: Blob & { type: string; size: number },
  now = Date.now(),
): Promise<string> {
  return uploadAsset("avatar", file, now);
}

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

export function classifyCredential(key: string | undefined): CredentialKind {
  if (!key) return "missing";
  if (key.startsWith("sb_publishable_")) return "publishable";

  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const claims = JSON.parse(
        atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
      ) as { role?: string };
      if (claims.role && claims.role !== "service_role") return "anon";
    } catch {
    }
  }

  return "plausible";
}

export function evaluateStorage(input: {
  credential: CredentialKind;
  bucket: string;
  found: {
    isPublic: boolean;
    fileSizeLimit: number | null;
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

export type RepairAction = "create" | "update" | null;

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

export async function deleteAsset(path: string): Promise<void> {
  const { error } = await serviceClient().storage.from(bucketName()).remove([path]);
  if (error) throw new Error(`Storage refused to delete the file: ${error.message}`);
}

export function publicAssetUrl(path: string | null): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${bucketName()}/${path}`;
}
