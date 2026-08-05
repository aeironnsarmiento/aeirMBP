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

/**
 * Only the byte delete is stood in for. Everything else in the storage module
 * stays real, so path minting and the asset-path check are exercised as
 * written — the delete is the one call that would reach a live bucket.
 */
const deleted = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("@/lib/site/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/site/storage")>()),
  deleteAsset: async (path: string) => {
    deleted.paths.push(path);
  },
}));

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
  deleted.paths = [];
  await db.delete(siteSetting);
});

describe("unauthenticated access (AE2, R34)", () => {
  it("rejects a settings mutation server-side", async () => {
    const { handleSettingsUpdate } = await import("./handlers");

    const response = await handleSettingsUpdate(post({ backgroundId: "dune" }));

    expect(response.status).toBe(404);
    expect((await readSiteSettings(db)).backgroundId).toBe(
      DEFAULT_SITE_SETTINGS.backgroundId,
    );
  });

  it("rejects a settings read", async () => {
    const { handleSettingsRead } = await import("./handlers");

    expect((await handleSettingsRead()).status).toBe(404);
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

    expect(response.status).toBe(404);
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

    expect(response.status).toBe(404);
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

    expect((await handleStorageCheck()).status).toBe(404);
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

    expect((await handleStorageRepair()).status).toBe(404);
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

function slotRequest(method: string, slot?: "light" | "dark", body?: unknown) {
  const url = slot
    ? `https://example.test/api/settings/upload?slot=${slot}`
    : "https://example.test/api/settings/upload";
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("the background pair (R8, AE3)", () => {
  it("assigns both slots in one patch", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    const response = await handleSettingsUpdate(
      post({ backgroundLightId: "frost", backgroundDarkId: "orchid" }),
    );

    expect(response.status).toBe(200);
    const settings = await readSiteSettings(db);
    expect(settings.backgroundLightId).toBe("frost");
    expect(settings.backgroundDarkId).toBe("orchid");
  });

  it("records an upload against the slot it names", async () => {
    const { handleUploadConfirm } = await import("./handlers");
    await asOwner();

    await handleUploadConfirm(
      slotRequest("PUT", "dark", { path: "background/1730000000001.png" }),
    );

    const settings = await readSiteSettings(db);
    expect(settings.backgroundDarkPath).toBe("background/1730000000001.png");
    expect(settings.backgroundDarkId).toBe("custom");
    // The single background is a separate slot and must not be co-opted.
    expect(settings.backgroundPath).toBeNull();
    expect(settings.backgroundLightPath).toBeNull();
  });

  it("clears one slot and leaves the other rendering", async () => {
    const { handleSettingsUpdate, handleBackgroundDelete } = await import("./handlers");
    await asOwner();
    await handleSettingsUpdate(
      post({ backgroundLightId: "frost", backgroundDarkId: "orchid" }),
    );

    const response = await handleBackgroundDelete(slotRequest("DELETE", "light"));

    expect(response.status).toBe(200);
    const settings = await readSiteSettings(db);
    expect(settings.backgroundLightId).toBeNull();
    expect(settings.backgroundDarkId).toBe("orchid");
  });

  it("refuses selecting a slot's custom background before anything is uploaded to it", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    const response = await handleSettingsUpdate(post({ backgroundLightId: "custom" }));

    expect(response.status).toBe(422);
    expect((await response.json()).field).toBe("backgroundLightId");
  });

  it("refuses a video into an empty slot, so a pair can never hold one", async () => {
    const { handleUploadConfirm } = await import("./handlers");
    await asOwner();

    const response = await handleUploadConfirm(
      slotRequest("PUT", "dark", { path: "background/1730000000002.mp4" }),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/two still images/);
    const settings = await readSiteSettings(db);
    expect(settings.backgroundDarkId).toBeNull();
    expect(settings.backgroundDarkPath).toBeNull();
  });

  it("refuses two videos as well, which are the same kind and still unrenderable", async () => {
    const { handleUploadConfirm } = await import("./handlers");
    await asOwner();

    for (const slot of ["light", "dark"] as const) {
      const response = await handleUploadConfirm(
        slotRequest("PUT", slot, { path: `background/173000000001${slot === "light" ? 0 : 1}.mp4` }),
      );
      expect(response.status).toBe(422);
    }

    const settings = await readSiteSettings(db);
    expect(settings.backgroundLightPath).toBeNull();
    expect(settings.backgroundDarkPath).toBeNull();
  });

  it("refuses a video upload into the second slot of an image pair", async () => {
    const { handleSettingsUpdate, handleUploadConfirm } = await import("./handlers");
    await asOwner();
    await handleSettingsUpdate(post({ backgroundLightId: "frost" }));

    const response = await handleUploadConfirm(
      slotRequest("PUT", "dark", { path: "background/1730000000003.mp4" }),
    );

    expect(response.status).toBe(422);
    expect((await readSiteSettings(db)).backgroundDarkPath).toBeNull();
  });

  it("still allows a video as the single background for both appearances", async () => {
    const { handleUploadConfirm } = await import("./handlers");
    await asOwner();

    const response = await handleUploadConfirm(
      slotRequest("PUT", undefined, { path: "background/1730000000004.mp4" }),
    );

    expect(response.status).toBe(200);
    expect((await readSiteSettings(db)).backgroundPath).toBe(
      "background/1730000000004.mp4",
    );
  });
});

describe("reference-counted byte deletion (R8, AE3)", () => {
  it("deletes the bytes when the slot it clears was the last reference", async () => {
    const { handleUploadConfirm, handleBackgroundDelete } = await import("./handlers");
    await asOwner();
    await handleUploadConfirm(
      slotRequest("PUT", "light", { path: "background/1730000000005.png" }),
    );

    await handleBackgroundDelete(slotRequest("DELETE", "light"));

    expect(deleted.paths).toEqual(["background/1730000000005.png"]);
  });

  it("leaves the bytes in place while the other slot still points at them", async () => {
    const { handleUploadConfirm, handleBackgroundDelete } = await import("./handlers");
    await asOwner();
    const path = "background/1730000000006.png";
    await handleUploadConfirm(slotRequest("PUT", "light", { path }));
    await handleUploadConfirm(slotRequest("PUT", "dark", { path }));

    await handleBackgroundDelete(slotRequest("DELETE", "light"));

    expect(deleted.paths).toEqual([]);
    const settings = await readSiteSettings(db);
    expect(settings.backgroundLightPath).toBeNull();
    expect(settings.backgroundDarkPath).toBe(path);
  });

  it("deletes the bytes once the second reference goes too", async () => {
    const { handleUploadConfirm, handleBackgroundDelete } = await import("./handlers");
    await asOwner();
    const path = "background/1730000000007.png";
    await handleUploadConfirm(slotRequest("PUT", "light", { path }));
    await handleUploadConfirm(slotRequest("PUT", "dark", { path }));

    await handleBackgroundDelete(slotRequest("DELETE", "light"));
    await handleBackgroundDelete(slotRequest("DELETE", "dark"));

    expect(deleted.paths).toEqual([path]);
  });

  it("does not delete a slot's bytes when the single background still names them", async () => {
    const { handleUploadConfirm, handleBackgroundDelete } = await import("./handlers");
    await asOwner();
    const path = "background/1730000000008.png";
    await handleUploadConfirm(slotRequest("PUT", undefined, { path }));
    await handleUploadConfirm(slotRequest("PUT", "dark", { path }));

    await handleBackgroundDelete(slotRequest("DELETE", "dark"));

    expect(deleted.paths).toEqual([]);
    expect((await readSiteSettings(db)).backgroundPath).toBe(path);
  });

  it("still clears the single background when no slot is named", async () => {
    const { handleUploadConfirm, handleBackgroundDelete } = await import("./handlers");
    await asOwner();
    await handleUploadConfirm(
      slotRequest("PUT", undefined, { path: "background/1730000000009.png" }),
    );

    await handleBackgroundDelete(slotRequest("DELETE"));

    const settings = await readSiteSettings(db);
    expect(settings.backgroundPath).toBeNull();
    expect(settings.backgroundId).toBe(DEFAULT_SITE_SETTINGS.backgroundId);
    expect(deleted.paths).toEqual(["background/1730000000009.png"]);
  });

  it("refuses a visitor", async () => {
    const { handleBackgroundDelete } = await import("./handlers");

    expect((await handleBackgroundDelete(slotRequest("DELETE", "light"))).status).toBe(
      404,
    );
    expect(deleted.paths).toEqual([]);
  });
});

describe("the appearance schedule (R9)", () => {
  it("persists a switchover time and target", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    const response = await handleSettingsUpdate(
      post({ themeSwitchoverAt: "19:00", themeSwitchoverTo: "dark" }),
    );

    expect(response.status).toBe(200);
    const settings = await readSiteSettings(db);
    expect(settings.themeSwitchoverAt).toBe("19:00");
    expect(settings.themeSwitchoverTo).toBe("dark");
  });

  it("rejects a malformed time, naming the field", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    const response = await handleSettingsUpdate(post({ themeSwitchoverAt: "25:00" }));

    expect(response.status).toBe(422);
    expect((await response.json()).field).toBe("themeSwitchoverAt");
    expect((await readSiteSettings(db)).themeSwitchoverAt).toBeNull();
  });

  it("clears the schedule", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();
    await handleSettingsUpdate(post({ themeSwitchoverAt: "19:00" }));

    await handleSettingsUpdate(post({ themeSwitchoverAt: null }));

    expect((await readSiteSettings(db)).themeSwitchoverAt).toBeNull();
  });
});
