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

describe("glass opacity (R8)", () => {
  it("persists a value inside the accepted range", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    await handleSettingsUpdate(post({ glassOpacity: 0.4 }));

    expect((await readSiteSettings(db)).glassOpacity).toBe(0.4);
  });

  it("rejects an out-of-range value rather than clamping it silently", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    for (const value of [GLASS_OPACITY_MIN - 0.01, GLASS_OPACITY_MAX + 0.01, 4, -1]) {
      const response = await handleSettingsUpdate(post({ glassOpacity: value }));
      expect(response.status).toBe(422);
    }

    expect((await readSiteSettings(db)).glassOpacity).toBe(
      DEFAULT_SITE_SETTINGS.glassOpacity,
    );
  });

  it("rejects a non-numeric value", async () => {
    const { handleSettingsUpdate } = await import("./handlers");
    await asOwner();

    expect((await handleSettingsUpdate(post({ glassOpacity: "0.5" }))).status).toBe(
      422,
    );
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
