// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { siteSetting } from "@/lib/db/schema";
import {
  DEFAULT_SITE_SETTINGS,
  SettingsValidationError,
  readSiteSettings,
  validatePatch,
  writeSiteSettings,
  type SiteDb,
} from "@/lib/site/settings";
import { publicAssetUrl } from "@/lib/site/storage";
import { createTestDb } from "@/test/pglite";

/** Swapped per test so the guard sees an owner or a visitor. */
let sessionCookie: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (sessionCookie ? { value: sessionCookie } : undefined) }),
}));

/**
 * The handlers reach for the real client, so it is pointed at the in-process
 * database. That keeps this an end-to-end test of the route — guard, patch
 * validation and persistence — rather than a test of a mock.
 */
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db/client", () => ({ getDb: () => holder.db }));

let db: SiteDb;
let close: () => Promise<void>;

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

describe("guarding the mutation handlers (R34)", () => {
  it("rejects an unauthenticated copy edit", async () => {
    const { handleAboutUpdate } = await import("./handlers");

    const response = await handleAboutUpdate(
      new Request("https://example.test/api/about", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aboutCopy: "sneaky" }),
      }),
    );

    expect(response.status).toBe(404);
  });

  it("rejects an unauthenticated read of the editing payload", async () => {
    const { handleAboutRead } = await import("./handlers");

    expect((await handleAboutRead()).status).toBe(404);
  });

  it("rejects a tampered session cookie", async () => {
    const { issueSessionToken } = await import("@/lib/auth/session");
    const { handleAboutRead } = await import("./handlers");
    const token = await issueSessionToken();
    sessionCookie = `${token.slice(0, -1)}x`;

    const response = await handleAboutRead();

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("refuses in the same words as the settings route, so neither confirms itself (AE5)", async () => {
    const { handleAboutRead } = await import("./handlers");
    const { handleSettingsRead } = await import(
      "@/widgets/settings/server/handlers"
    );

    const print = async (response: Response) => ({
      status: response.status,
      headers: [...response.headers.entries()].sort(),
      body: await response.text(),
    });

    expect(await print(await handleAboutRead())).toEqual(
      await print(await handleSettingsRead()),
    );
  });

  it("admits a valid owner session", async () => {
    const { issueSessionToken } = await import("@/lib/auth/session");
    const { handleAboutRead } = await import("./handlers");
    sessionCookie = await issueSessionToken();

    expect((await handleAboutRead()).status).toBe(200);
  });

  it("persists an owner edit and serves it to the next unauthenticated load", async () => {
    const { issueSessionToken } = await import("@/lib/auth/session");
    const { handleAboutUpdate } = await import("./handlers");
    sessionCookie = await issueSessionToken();

    const response = await handleAboutUpdate(
      new Request("https://example.test/api/about", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aboutCopy: "Edited by the owner." }),
      }),
    );
    expect(response.status).toBe(200);

    // What a visitor's server render reads.
    sessionCookie = undefined;
    expect((await readSiteSettings(db)).aboutCopy).toBe("Edited by the owner.");
  });

  it("returns 422 with the offending field on an invalid edit", async () => {
    const { issueSessionToken } = await import("@/lib/auth/session");
    const { handleAboutUpdate } = await import("./handlers");
    sessionCookie = await issueSessionToken();

    const response = await handleAboutUpdate(
      new Request("https://example.test/api/about", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          links: [{ label: "bad", href: "javascript:alert(1)" }],
        }),
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ field: "links" });
  });

  it("ignores fields the About form has no business setting", async () => {
    const { issueSessionToken } = await import("@/lib/auth/session");
    const { handleAboutUpdate } = await import("./handlers");
    sessionCookie = await issueSessionToken();

    await handleAboutUpdate(
      new Request("https://example.test/api/about", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ frameOpacity: 0.99, backgroundId: "nope" }),
      }),
    );

    const settings = await readSiteSettings(db);
    expect(settings.frameOpacity).toBe(DEFAULT_SITE_SETTINGS.frameOpacity);
    expect(settings.backgroundId).toBe(DEFAULT_SITE_SETTINGS.backgroundId);
  });
});

describe("About copy persistence (R17)", () => {
  it("persists an edit and returns it on the next read", async () => {
    await writeSiteSettings({ aboutCopy: "Rewritten bio." }, db);

    expect((await readSiteSettings(db)).aboutCopy).toBe("Rewritten bio.");
  });

  it("falls back to defaults for keys the owner has never set", async () => {
    const settings = await readSiteSettings(db);

    expect(settings.aboutCopy).toBe(DEFAULT_SITE_SETTINGS.aboutCopy);
    expect(settings.backgroundId).toBe(DEFAULT_SITE_SETTINGS.backgroundId);
    expect(settings.avatarPath).toBeNull();
  });

  it("leaves untouched fields alone when a patch sets only one", async () => {
    await writeSiteSettings({ name: "Aeiron", location: "Manila" }, db);
    await writeSiteSettings({ aboutCopy: "New bio." }, db);

    const settings = await readSiteSettings(db);
    expect(settings.name).toBe("Aeiron");
    expect(settings.location).toBe("Manila");
    expect(settings.aboutCopy).toBe("New bio.");
  });

  it("stores name, handle, location and links (R19)", async () => {
    await writeSiteSettings(
      {
        name: "Aeiron",
        handle: "xenavalon",
        location: "Manila",
        links: [{ label: "last.fm", href: "https://www.last.fm/user/xenavalon" }],
      },
      db,
    );

    expect(await readSiteSettings(db)).toMatchObject({
      name: "Aeiron",
      handle: "xenavalon",
      location: "Manila",
      links: [{ label: "last.fm", href: "https://www.last.fm/user/xenavalon" }],
    });
  });

  it("rejects copy beyond the length ceiling rather than truncating it", async () => {
    await expect(
      writeSiteSettings({ aboutCopy: "x".repeat(5_000) }, db),
    ).rejects.toBeInstanceOf(SettingsValidationError);
  });

  it("rejects a link href that is not http or https", () => {
    expect(() =>
      validatePatch({
        links: [{ label: "bad", href: "javascript:alert(1)" }],
      }),
    ).toThrow(SettingsValidationError);
  });

  it("rejects a malformed link entry", () => {
    expect(() =>
      validatePatch({ links: [{ label: "x" } as never] }),
    ).toThrow(SettingsValidationError);
  });
});

describe("avatar URL resolution (R18)", () => {
  it("resolves a stored path to a public URL for both About and the sidebar", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_STORAGE_BUCKET = "site-assets";

    expect(publicAssetUrl("avatar/123.png")).toBe(
      "https://project.supabase.co/storage/v1/object/public/site-assets/avatar/123.png",
    );
  });

  it("resolves to null when no avatar has been uploaded", () => {
    expect(publicAssetUrl(null)).toBeNull();
  });
});
