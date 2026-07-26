// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { siteSetting } from "@/lib/db/schema";
import { assembleRegistry, visibleWidgets } from "@/lib/registry/assemble";
import {
  DEFAULT_SITE_SETTINGS,
  GLASS_OPACITY_MAX,
  GLASS_OPACITY_MIN,
  readSiteSettings,
  type SiteDb,
} from "@/lib/site/settings";
import { createTestDb } from "@/test/pglite";
import { aboutManifest } from "@/widgets/about/manifest";
import { settingsManifest } from "@/widgets/settings/manifest";

let sessionCookie: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (sessionCookie ? { value: sessionCookie } : undefined),
  }),
}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db/client", () => ({ getDb: () => holder.db }));

let db: SiteDb;
let close: () => Promise<void>;

async function asOwner() {
  const { issueSessionToken } = await import("@/lib/auth/session");
  sessionCookie = await issueSessionToken();
}

function post(body: unknown) {
  return new Request("https://example.test/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  process.env.OWNER_SECRET = "owner-secret-long-enough-to-pass";
  ({ db, close } = await createTestDb());
  holder.db = db;
});

afterAll(async () => {
  await close();
  delete process.env.OWNER_SECRET;
});

beforeEach(async () => {
  sessionCookie = undefined;
  await db.delete(siteSetting);
});

describe("unauthenticated access (AE2, R34)", () => {
  it("rejects a settings mutation server-side", async () => {
    const { handleSettingsUpdate } = await import("./handlers");

    const response = await handleSettingsUpdate(post({ backgroundId: "dune" }));

    expect(response.status).toBe(401);
    expect((await readSiteSettings(db)).backgroundId).toBe(
      DEFAULT_SITE_SETTINGS.backgroundId,
    );
  });

  it("rejects a settings read", async () => {
    const { handleSettingsRead } = await import("./handlers");

    expect((await handleSettingsRead()).status).toBe(401);
  });

  it("omits the settings manifest from an unauthenticated registry", () => {
    const registry = assembleRegistry([aboutManifest, settingsManifest]);

    const ids = visibleWidgets(registry, false).map((entry) => entry.id);

    expect(ids).not.toContain("settings");
    expect(visibleWidgets(registry, true).map((entry) => entry.id)).toContain(
      "settings",
    );
  });
});

describe("background selection (R8)", () => {
  it("persists an authenticated change and returns it on the next read", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    const response = await handleSettingsUpdate(post({ backgroundId: "dune" }));

    expect(response.status).toBe(200);
    expect((await readSiteSettings(db)).backgroundId).toBe("dune");
  });

  it("rejects a background id that is not in the committed set", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    const response = await handleSettingsUpdate(
      post({ backgroundId: "../../etc/passwd" }),
    );

    expect(response.status).toBe(422);
    expect((await readSiteSettings(db)).backgroundId).toBe(
      DEFAULT_SITE_SETTINGS.backgroundId,
    );
  });
});

describe("glass opacity (R14, R15)", () => {
  it("persists the frame and the panes as independent values", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    await handleSettingsUpdate(post({ frameOpacity: 0.4, paneOpacity: 0.7 }));

    const settings = await readSiteSettings(db);
    expect(settings.frameOpacity).toBe(0.4);
    expect(settings.paneOpacity).toBe(0.7);
  });

  it("leaves the other dial alone when only one is patched", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    await handleSettingsUpdate(post({ frameOpacity: 0.3, paneOpacity: 0.8 }));
    await handleSettingsUpdate(post({ frameOpacity: 0.5 }));

    const settings = await readSiteSettings(db);
    expect(settings.frameOpacity).toBe(0.5);
    expect(settings.paneOpacity).toBe(0.8);
  });

  it("rejects an out-of-range frame value, naming the frame", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    const response = await handleSettingsUpdate(
      post({ frameOpacity: GLASS_OPACITY_MIN - 0.01 }),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).field).toBe("frameOpacity");
    expect((await readSiteSettings(db)).frameOpacity).toBe(
      DEFAULT_SITE_SETTINGS.frameOpacity,
    );
  });

  it("rejects an out-of-range pane value, naming the panes", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    const response = await handleSettingsUpdate(
      post({ paneOpacity: GLASS_OPACITY_MAX + 0.01 }),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).field).toBe("paneOpacity");
    expect((await readSiteSettings(db)).paneOpacity).toBe(
      DEFAULT_SITE_SETTINGS.paneOpacity,
    );
  });

  it("rejects out-of-range values rather than clamping them silently", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    for (const value of [GLASS_OPACITY_MIN - 0.01, GLASS_OPACITY_MAX + 0.01, 4, -1]) {
      expect(
        (await handleSettingsUpdate(post({ frameOpacity: value }))).status,
      ).toBe(422);
    }
  });

  it("rejects a non-numeric value on either dial", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    expect(
      (await handleSettingsUpdate(post({ frameOpacity: "0.5" }))).status,
    ).toBe(422);
    expect((await handleSettingsUpdate(post({ paneOpacity: "0.5" }))).status).toBe(
      422,
    );
  });

  it("returns both defaults when neither has ever been written", async () => {
    const settings = await readSiteSettings(db);

    expect(settings.frameOpacity).toBe(DEFAULT_SITE_SETTINGS.frameOpacity);
    expect(settings.paneOpacity).toBe(DEFAULT_SITE_SETTINGS.paneOpacity);
  });
});

describe("scope", () => {
  it("ignores About fields, which the About handler owns", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    await handleSettingsUpdate(post({ aboutCopy: "written via settings" }));

    expect((await readSiteSettings(db)).aboutCopy).toBe(
      DEFAULT_SITE_SETTINGS.aboutCopy,
    );
  });
});

function jsonRequest(method: string, body: unknown) {
  return new Request("https://example.test/api/settings/upload", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("background upload permission (R12, R13)", () => {
  it("refuses a file above the background ceiling before touching storage", async () => {
    const { handleUploadSign } = await import("./handlers");
    await asOwner();

    const response = await handleUploadSign(
      jsonRequest("POST", { type: "image/gif", size: 11 * 1024 * 1024 }),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/the limit is 10MB/);
  });

  it("refuses an unsupported type, naming it", async () => {
    const { handleUploadSign } = await import("./handlers");
    await asOwner();

    const response = await handleUploadSign(
      jsonRequest("POST", { type: "application/pdf", size: 1_000 }),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/application\/pdf/);
  });

  it("refuses a request that does not describe the file", async () => {
    const { handleUploadSign } = await import("./handlers");
    await asOwner();

    expect(
      (await handleUploadSign(jsonRequest("POST", { size: 10 }))).status,
    ).toBe(400);
  });

  it("refuses a visitor without issuing a target", async () => {
    const { handleUploadSign } = await import("./handlers");

    const response = await handleUploadSign(
      jsonRequest("POST", { type: "image/gif", size: 1_000 }),
    );

    expect(response.status).toBe(401);
  });
});

describe("recording an uploaded background (R11, R13)", () => {
  it("persists the path and selects it in one step", async () => {
    const { handleUploadConfirm } = await import("./handlers");
    await asOwner();

    const response = await handleUploadConfirm(
      jsonRequest("PUT", { path: "background/1730000000000.gif" }),
    );

    expect(response.status).toBe(200);

    const settings = await readSiteSettings(db);
    expect(settings.backgroundPath).toBe("background/1730000000000.gif");
    expect(settings.backgroundId).toBe("custom");
  });

  it("refuses a path this site never issued", async () => {
    const { handleUploadConfirm } = await import("./handlers");
    await asOwner();

    for (const path of [
      "avatar/1.png",
      "../../etc/passwd",
      "background/evil.gif",
      "https://elsewhere.example/x.gif",
    ]) {
      const response = await handleUploadConfirm(jsonRequest("PUT", { path }));
      expect(response.status).toBe(400);
    }

    expect((await readSiteSettings(db)).backgroundPath).toBeNull();
  });

  it("refuses a visitor", async () => {
    const { handleUploadConfirm } = await import("./handlers");

    const response = await handleUploadConfirm(
      jsonRequest("PUT", { path: "background/1.gif" }),
    );

    expect(response.status).toBe(401);
    expect((await readSiteSettings(db)).backgroundPath).toBeNull();
  });
});

describe("selecting the custom background (R11)", () => {
  it("refuses the reserved id when nothing has been uploaded", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    const response = await handleSettingsUpdate(post({ backgroundId: "custom" }));

    expect(response.status).toBe(422);
    expect((await response.json()).field).toBe("backgroundId");
    expect((await readSiteSettings(db)).backgroundId).toBe(
      DEFAULT_SITE_SETTINGS.backgroundId,
    );
  });

  it("keeps the uploaded image when a preset is selected afterwards", async () => {
    const { handleSettingsUpdate, handleUploadConfirm } = await import("./handlers");
    await asOwner();

    await handleUploadConfirm(jsonRequest("PUT", { path: "background/7.gif" }));
    await handleSettingsUpdate(post({ backgroundId: "dune" }));

    const settings = await readSiteSettings(db);
    expect(settings.backgroundId).toBe("dune");
    expect(settings.backgroundPath).toBe("background/7.gif");
  });

  it("allows re-selecting the custom background without re-uploading", async () => {
    const { handleSettingsUpdate, handleUploadConfirm } = await import("./handlers");
    await asOwner();

    await handleUploadConfirm(jsonRequest("PUT", { path: "background/7.gif" }));
    await handleSettingsUpdate(post({ backgroundId: "dune" }));
    const response = await handleSettingsUpdate(post({ backgroundId: "custom" }));

    expect(response.status).toBe(200);
    expect((await readSiteSettings(db)).backgroundId).toBe("custom");
  });

  it("still rejects an id that is neither a preset nor the reserved one", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    expect(
      (await handleSettingsUpdate(post({ backgroundId: "nope" }))).status,
    ).toBe(422);
  });
});

describe("storage self-check (R18)", () => {
  it("refuses a visitor", async () => {
    const { handleStorageCheck } = await import("./handlers");

    expect((await handleStorageCheck()).status).toBe(401);
  });

  it("reports the credential fault rather than a vendor string", async () => {
    const { handleStorageCheck } = await import("./handlers");
    await asOwner();
    const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_publishable_abc";

    const body = await (await handleStorageCheck()).json();

    expect(body.ok).toBe(false);
    expect(body.fault).toBe("credential");
    expect(body.message).toMatch(/service_role/);
    expect(body.message).not.toMatch(/sb_publishable_abc/);

    if (saved === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
  });
});

describe("storage repair (R18)", () => {
  it("refuses a visitor", async () => {
    const { handleStorageRepair } = await import("./handlers");

    expect((await handleStorageRepair()).status).toBe(401);
  });

  it("reports the credential fault instead of calling storage with a bad key", async () => {
    const { handleStorageRepair } = await import("./handlers");
    await asOwner();
    const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_publishable_abc";

    const response = await handleStorageRepair();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.fault).toBe("credential");

    if (saved === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
  });
});
