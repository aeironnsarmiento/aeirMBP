// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/test/pglite";
import { DEFAULT_BACKGROUND_ID } from "@/lib/theme/backgrounds";
import { readSiteSettings, writeSiteSettings } from "./settings";

/**
 * Real Postgres, because the behaviour under test is a schema constraint.
 * `site_setting.value` is `jsonb NOT NULL`, and a fake that accepted null
 * would pass while production rejected the same write.
 */
type Db = Awaited<ReturnType<typeof createTestDb>>;

let harness: Db;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the site writer takes its own db shape
const db = () => harness.db as any;

beforeEach(async () => {
  harness = await createTestDb();
});

afterEach(async () => {
  await harness.close();
});

describe("clearing a setting", () => {
  it("removes an uploaded background instead of writing null into a NOT NULL column", async () => {
    await writeSiteSettings(
      { backgroundPath: "background/123.mp4", backgroundId: "custom" },
      db(),
    );
    expect((await readSiteSettings(db())).backgroundPath).toBe("background/123.mp4");

    // The delete path. Writing null here previously failed the insert outright.
    const after = await writeSiteSettings(
      { backgroundPath: null, backgroundId: DEFAULT_BACKGROUND_ID },
      db(),
    );

    expect(after.backgroundPath).toBeNull();
    expect(after.backgroundId).toBe(DEFAULT_BACKGROUND_ID);
  });

  it("reads back as null on a fresh read, not just in the write's return value", async () => {
    await writeSiteSettings({ backgroundPath: "background/1.gif" }, db());
    await writeSiteSettings({ backgroundPath: null }, db());

    expect((await readSiteSettings(db())).backgroundPath).toBeNull();
  });

  it("clears and writes in the same patch", async () => {
    await writeSiteSettings({ backgroundPath: "background/1.gif" }, db());

    const after = await writeSiteSettings(
      { backgroundPath: null, frameOpacity: 0.7 },
      db(),
    );

    expect(after.backgroundPath).toBeNull();
    expect(after.frameOpacity).toBe(0.7);
  });

  it("leaves other settings untouched", async () => {
    await writeSiteSettings(
      { backgroundPath: "background/1.gif", paneOpacity: 0.6 },
      db(),
    );
    await writeSiteSettings({ backgroundPath: null }, db());

    expect((await readSiteSettings(db())).paneOpacity).toBe(0.6);
  });

  it("is safe to clear something that was never set", async () => {
    const after = await writeSiteSettings({ backgroundPath: null }, db());
    expect(after.backgroundPath).toBeNull();
  });

  it("clears twice without error", async () => {
    await writeSiteSettings({ backgroundPath: "background/1.gif" }, db());
    await writeSiteSettings({ backgroundPath: null }, db());
    await writeSiteSettings({ backgroundPath: null }, db());

    expect((await readSiteSettings(db())).backgroundPath).toBeNull();
  });
});
