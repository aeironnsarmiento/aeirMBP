// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/test/pglite";
import { DEFAULT_BACKGROUND_ID } from "@/lib/theme/backgrounds";
import { readSiteSettings, writeSiteSettings } from "../settings";

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

describe("the background pair and the schedule (R8, R9)", () => {
  it("reads each new field back as its own type, not as an empty string", async () => {
    // The reader's default branch coerces through a string helper, so a field
    // without an explicit case round-trips to "" with no error anywhere.
    await writeSiteSettings(
      {
        backgroundLightId: "frost",
        backgroundDarkId: "aurora",
        backgroundLightPath: "background/1.png",
        backgroundDarkPath: "background/2.png",
        themeSwitchoverAt: "19:00",
        themeSwitchoverTo: "dark",
      },
      db(),
    );

    const settings = await readSiteSettings(db());

    expect(settings.backgroundLightId).toBe("frost");
    expect(settings.backgroundDarkId).toBe("aurora");
    expect(settings.backgroundLightPath).toBe("background/1.png");
    expect(settings.backgroundDarkPath).toBe("background/2.png");
    expect(settings.themeSwitchoverAt).toBe("19:00");
    expect(settings.themeSwitchoverTo).toBe("dark");
  });

  it("assigns both members of a pair in one patch", async () => {
    const after = await writeSiteSettings(
      { backgroundLightId: "frost", backgroundDarkId: "orchid" },
      db(),
    );

    expect(after.backgroundLightId).toBe("frost");
    expect(after.backgroundDarkId).toBe("orchid");
  });

  it("leaves neither member written when the patch fails partway", async () => {
    await expect(
      writeSiteSettings(
        // Valid, valid, then rejected — the whole patch must be refused.
        {
          backgroundLightId: "frost",
          backgroundDarkId: "orchid",
          themeSwitchoverAt: "25:00",
        },
        db(),
      ),
    ).rejects.toThrow(/Switchover time/);

    const settings = await readSiteSettings(db());
    expect(settings.backgroundLightId).toBeNull();
    expect(settings.backgroundDarkId).toBeNull();
  });

  it("clears one slot without disturbing the other", async () => {
    await writeSiteSettings(
      { backgroundLightId: "frost", backgroundDarkId: "orchid" },
      db(),
    );

    const after = await writeSiteSettings(
      { backgroundLightId: null, backgroundLightPath: null },
      db(),
    );

    expect(after.backgroundLightId).toBeNull();
    expect(after.backgroundDarkId).toBe("orchid");
  });

  it("leaves a background configured under the old key alone", async () => {
    await writeSiteSettings(
      { backgroundId: "dune", backgroundPath: "background/legacy.png" },
      db(),
    );

    await writeSiteSettings({ frameOpacity: 0.4 }, db());

    const settings = await readSiteSettings(db());
    expect(settings.backgroundId).toBe("dune");
    expect(settings.backgroundPath).toBe("background/legacy.png");
    expect(settings.backgroundLightId).toBeNull();
    expect(settings.backgroundDarkId).toBeNull();
  });

  it("rejects a switchover time outside the daily range, naming the field", async () => {
    for (const value of ["24:00", "19:60", "7:00", "1900", "", "evening"]) {
      await expect(
        writeSiteSettings({ themeSwitchoverAt: value }, db()),
      ).rejects.toMatchObject({ field: "themeSwitchoverAt" });
    }

    expect((await readSiteSettings(db())).themeSwitchoverAt).toBeNull();
  });

  it("accepts the boundaries of the daily range", async () => {
    for (const value of ["00:00", "23:59", "09:05"]) {
      const after = await writeSiteSettings({ themeSwitchoverAt: value }, db());
      expect(after.themeSwitchoverAt).toBe(value);
    }
  });

  it("rejects an unknown background id in either slot", async () => {
    await expect(
      writeSiteSettings({ backgroundLightId: "../../etc/passwd" }, db()),
    ).rejects.toMatchObject({ field: "backgroundLightId" });
    await expect(
      writeSiteSettings({ backgroundDarkId: "nope" }, db()),
    ).rejects.toMatchObject({ field: "backgroundDarkId" });
  });

  it("clears the schedule by writing null rather than an empty string", async () => {
    await writeSiteSettings({ themeSwitchoverAt: "19:00" }, db());

    const after = await writeSiteSettings({ themeSwitchoverAt: null }, db());

    expect(after.themeSwitchoverAt).toBeNull();
  });

  it("falls back rather than trusting a stored value the schema no longer allows", async () => {
    // Written by an older build, or by hand. The reader must not hand it on.
    const { siteSetting } = await import("@/lib/db/schema");
    await db()
      .insert(siteSetting)
      .values([
        { key: "theme.switchoverAt", value: "half past nine", updatedAt: new Date() },
        { key: "theme.backgroundLight", value: { id: "frost" }, updatedAt: new Date() },
        { key: "theme.switchoverTo", value: "purple", updatedAt: new Date() },
      ]);

    const settings = await readSiteSettings(db());

    expect(settings.themeSwitchoverAt).toBeNull();
    expect(settings.backgroundLightId).toBeNull();
    expect(settings.themeSwitchoverTo).toBe("dark");
  });
});
