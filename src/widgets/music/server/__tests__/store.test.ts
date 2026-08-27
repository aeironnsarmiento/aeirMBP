// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { musicTrack } from "@/lib/db/schema";
import { createTestDb } from "@/test/pglite";
import type { MusicDb } from "../../queries/aggregations";
import { trackKey } from "../normalize";
import { createDrizzleStore, ENRICHMENT_RETRY_AFTER_MS } from "../store";

const ARTIST = "Radiohead";
const TRACK = "Weird Fishes";
const KEY = trackKey(ARTIST, TRACK);

let db: MusicDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(() => close());

async function insertTrack(attemptedDaysAgo: number | null, artworkUrl: string | null) {
  await db.insert(musicTrack).values({
    trackKey: KEY,
    artistKey: ARTIST.toLowerCase(),
    artistName: ARTIST,
    trackName: TRACK,
    albumName: null,
    durationMs: 261_000,
    artworkUrl,
    enrichedAt: attemptedDaysAgo === null ? null : new Date(),
    attemptedAt:
      attemptedDaysAgo === null
        ? null
        : new Date(Date.now() - attemptedDaysAgo * 24 * 60 * 60 * 1000),
  });
}

describe("the enrichment retry window", () => {
  it("offers a never-attempted track", async () => {
    await insertTrack(null, null);

    expect(await createDrizzleStore(db).countPendingEnrichment()).toBe(1);
  });

  it("holds back a track attempted recently", async () => {
    await insertTrack(5, null);

    expect(await createDrizzleStore(db).countPendingEnrichment()).toBe(0);
  });

  it("offers a track whose last attempt has aged out, artwork still missing", async () => {
    await insertTrack(40, null);
    const store = createDrizzleStore(db);

    expect(await store.countPendingEnrichment()).toBe(1);
    expect(await store.pendingEnrichment(10)).toEqual([
      { trackKey: KEY, artistName: ARTIST, trackName: TRACK, albumName: null },
    ]);
  });

  it("leaves a fully enriched track alone however old the attempt", async () => {
    await insertTrack(400, "https://cdn.example/cover.jpg");

    expect(await createDrizzleStore(db).countPendingEnrichment()).toBe(0);
  });

  it("uses a thirty-day window", () => {
    expect(ENRICHMENT_RETRY_AFTER_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("recording an enrichment result", () => {
  it("does not let a duration-only hit erase artwork already stored", async () => {
    await insertTrack(null, null);
    const store = createDrizzleStore(db);

    await store.recordEnrichment(KEY, {
      durationMs: null,
      artworkUrl: "https://cdn.example/cover.jpg",
      source: "musicbrainz",
    });
    await store.recordEnrichment(KEY, {
      durationMs: 999_000,
      artworkUrl: null,
      source: "deezer",
    });

    const [row] = await db.select().from(musicTrack);
    expect(row.artworkUrl).toBe("https://cdn.example/cover.jpg");
    expect(row.durationMs).toBe(999_000);
  });

  it("bumps the attempt stamp on a miss even for a partly enriched track", async () => {
    await insertTrack(40, null);
    const store = createDrizzleStore(db);

    const [before] = await db.select().from(musicTrack);
    await store.recordEnrichmentMiss(KEY);
    const [after] = await db.select().from(musicTrack);

    expect(after.attemptedAt!.getTime()).toBeGreaterThan(
      before.attemptedAt!.getTime(),
    );
    expect(await store.countPendingEnrichment()).toBe(0);
  });
});
