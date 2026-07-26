// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACCEPTED_ASSET_TYPES } from "./schema";
import {
  UploadRejected,
  assetPath,
  bucketName,
  classifyCredential,
  evaluateStorage,
  isAssetPath,
  publicAssetUrl,
  repairPlan,
  uploadAsset,
} from "./storage";

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("object paths", () => {
  it("prefixes by kind so the two never collide", () => {
    expect(assetPath("avatar", "image/png", 123)).toBe("avatar/123.png");
    expect(assetPath("background", "image/gif", 123)).toBe("background/123.gif");
  });

  it("mints a new path per upload, so a CDN never serves the old bytes", () => {
    expect(assetPath("avatar", "image/png", 1)).not.toBe(
      assetPath("avatar", "image/png", 2),
    );
  });

  it("falls back to a neutral extension for an unmapped type", () => {
    expect(assetPath("avatar", "image/tiff", 5)).toBe("avatar/5.bin");
  });

  it("recognises only paths this app would have minted for that kind", () => {
    expect(isAssetPath("background", "background/123.gif")).toBe(true);
    expect(isAssetPath("background", "avatar/123.gif")).toBe(false);
    expect(isAssetPath("background", "../../etc/passwd")).toBe(false);
    expect(isAssetPath("background", "background/evil.gif")).toBe(false);
  });
});

describe("public URLs", () => {
  it("builds one from the configured bucket and the stored path", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_STORAGE_BUCKET = "site-assets";

    expect(publicAssetUrl("background/9.gif")).toBe(
      "https://project.supabase.co/storage/v1/object/public/site-assets/background/9.gif",
    );
  });

  it("resolves to null when nothing has been uploaded", () => {
    expect(publicAssetUrl(null)).toBeNull();
  });

  it("defaults the bucket name rather than producing an undefined segment", () => {
    delete process.env.SUPABASE_STORAGE_BUCKET;
    expect(bucketName()).toBe("site-assets");
  });
});

describe("configuration faults surface as instructions (R19)", () => {
  it("names the missing configuration instead of throwing an SDK error", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    await expect(
      uploadAsset(
        "avatar",
        new Blob(["x"], { type: "image/png" }) as Blob & {
          type: string;
          size: number;
        },
      ),
    ).rejects.toThrow(/Supabase Storage is not configured/);
  });

  it("refuses an invalid file before it ever reaches storage", async () => {
    // Credentials absent on purpose: the type check must fire first, so a
    // rejection here proves validation runs ahead of any network call.
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    await expect(
      uploadAsset(
        "avatar",
        new Blob(["x"], { type: "application/pdf" }) as Blob & {
          type: string;
          size: number;
        },
      ),
    ).rejects.toThrow(UploadRejected);
  });
});

describe("credential classification (R19)", () => {
  it("recognises an absent credential", () => {
    expect(classifyCredential(undefined)).toBe("missing");
    expect(classifyCredential("")).toBe("missing");
  });

  it("recognises the new-format publishable key that caused the outage", () => {
    expect(classifyCredential("sb_publishable_abc123")).toBe("publishable");
  });

  it("recognises a legacy anon JWT by its role claim", () => {
    const jwt = (role: string) =>
      `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.sig`;

    expect(classifyCredential(jwt("anon"))).toBe("anon");
    expect(classifyCredential(jwt("service_role"))).toBe("plausible");
  });

  it("passes an unreadable key through rather than guessing", () => {
    expect(classifyCredential("sb_secret_abc123")).toBe("plausible");
    expect(classifyCredential("not.a.jwt")).toBe("plausible");
  });
});

describe("storage evaluation (R18, R19, R20)", () => {
  const base = {
    bucket: "site-assets",
    requiredBytes: 10 * 1024 * 1024,
  };

  it("reports the credential fault first, without probing the bucket", () => {
    const result = evaluateStorage({
      ...base,
      credential: "publishable",
      found: null,
    });

    expect(result.fault).toBe("credential");
    expect(result.message).toMatch(/service_role/);
    // The bucket is never mentioned, because it was never the question.
    expect(result.message).not.toMatch(/site-assets/);
  });

  it("names the expected bucket when it does not exist", () => {
    const result = evaluateStorage({
      ...base,
      credential: "plausible",
      found: null,
    });

    expect(result.fault).toBe("bucket");
    expect(result.message).toMatch(/site-assets/);
  });

  it("reports a private bucket, stating that uploads will succeed anyway", () => {
    const result = evaluateStorage({
      ...base,
      credential: "plausible",
      found: { isPublic: false, fileSizeLimit: null },
    });

    expect(result.fault).toBe("visibility");
    expect(result.message).toMatch(/Uploads will succeed/);
  });

  it("reports a bucket limit below the site's own ceiling", () => {
    const result = evaluateStorage({
      ...base,
      credential: "plausible",
      found: { isPublic: true, fileSizeLimit: 5 * 1024 * 1024 },
    });

    expect(result.fault).toBe("limit");
    expect(result.message).toMatch(/caps files at 5MB, below the 10MB/);
  });

  it("reports usable when every probe passes", () => {
    const result = evaluateStorage({
      ...base,
      credential: "plausible",
      found: { isPublic: true, fileSizeLimit: 50 * 1024 * 1024 },
    });

    expect(result.ok).toBe(true);
    expect(result.fault).toBeNull();
  });

  it("accepts a bucket with no explicit file limit", () => {
    const result = evaluateStorage({
      ...base,
      credential: "plausible",
      found: { isPublic: true, fileSizeLimit: null },
    });

    expect(result.ok).toBe(true);
  });

  it("reports a type list narrower than what this site accepts", () => {
    const result = evaluateStorage({
      ...base,
      credential: "plausible",
      found: {
        isPublic: true,
        fileSizeLimit: null,
        allowedTypes: ["image/png"],
      },
    });

    expect(result.fault).toBe("types");
    expect(result.message).toMatch(/image\/gif/);
  });

  it("accepts a bucket that restricts nothing", () => {
    const result = evaluateStorage({
      ...base,
      credential: "plausible",
      found: { isPublic: true, fileSizeLimit: null, allowedTypes: null },
    });

    expect(result.ok).toBe(true);
  });

  it("accepts a bucket whose list covers every accepted type", () => {
    const result = evaluateStorage({
      ...base,
      credential: "plausible",
      found: {
        isPublic: true,
        fileSizeLimit: null,
        allowedTypes: [...ACCEPTED_ASSET_TYPES],
      },
    });

    expect(result.ok).toBe(true);
  });
});

describe("repair planning (R18)", () => {
  const check = (fault: string | null) =>
    ({ ok: fault === null, fault, message: "" }) as Parameters<
      typeof repairPlan
    >[0];

  it("creates the bucket when there is none", () => {
    expect(repairPlan(check("bucket"))).toBe("create");
  });

  it("updates the bucket for a setting that is merely wrong", () => {
    expect(repairPlan(check("visibility"))).toBe("update");
    expect(repairPlan(check("limit"))).toBe("update");
    expect(repairPlan(check("types"))).toBe("update");
  });

  it("declines a credential fault, which no bucket call can fix", () => {
    expect(repairPlan(check("credential"))).toBeNull();
  });

  it("does nothing when storage is already usable", () => {
    expect(repairPlan(check(null))).toBeNull();
  });
});
