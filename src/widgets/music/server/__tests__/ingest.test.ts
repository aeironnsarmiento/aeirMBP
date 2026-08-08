// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { LastfmPlay } from "../../lastfm/client";
import { ingestPlays, toScrobbleRows, toTrackSeeds } from "../ingest";
import { trackKey } from "../normalize";
import { createMemoryStore } from "../store.memory";

function play(overrides: Partial<LastfmPlay> = {}): LastfmPlay {
  return {
    artist: "Radiohead",
    track: "Weird Fishes",
    album: "In Rainbows",
    imageUrl: null,
    playedAt: new Date("2026-07-20T10:00:00.000Z"),
    nowPlaying: false,
    ...overrides,
  };
}

describe("idempotent ingestion (AE3)", () => {
  it("inserts nothing when every play in the page is already stored", async () => {
    const store = createMemoryStore();
    const page = [
      play({ playedAt: new Date("2026-07-20T10:00:00.000Z") }),
      play({ track: "Nude", playedAt: new Date("2026-07-20T10:05:00.000Z") }),
    ];

    const first = await ingestPlays(store, page);
    const second = await ingestPlays(store, page);

    expect(first.inserted).toBe(2);
    expect(second.inserted).toBe(0);
    expect(await store.countScrobbles()).toBe(2);
  });

  it("inserts only the new plays from a partially overlapping page", async () => {
    const store = createMemoryStore();
    const stored = play({ playedAt: new Date("2026-07-20T10:00:00.000Z") });
    await ingestPlays(store, [stored]);

    const result = await ingestPlays(store, [
      stored,
      play({ track: "Nude", playedAt: new Date("2026-07-20T10:05:00.000Z") }),
      play({ track: "Reckoner", playedAt: new Date("2026-07-20T10:10:00.000Z") }),
    ]);

    expect(result.inserted).toBe(2);
    expect(await store.countScrobbles()).toBe(3);
  });

  it("treats differing client spellings of one play as the same row", async () => {
    const store = createMemoryStore();
    const at = new Date("2026-07-20T10:00:00.000Z");

    await ingestPlays(store, [play({ track: "Weird Fishes", playedAt: at })]);
    const second = await ingestPlays(store, [
      play({ track: "weird   fishes (2011 Remaster)", playedAt: at }),
    ]);

    expect(second.inserted).toBe(0);
    expect(await store.countScrobbles()).toBe(1);
  });

  it("stores the same track played twice as two rows", async () => {
    const store = createMemoryStore();

    const result = await ingestPlays(store, [
      play({ playedAt: new Date("2026-07-20T10:00:00.000Z") }),
      play({ playedAt: new Date("2026-07-20T13:41:00.000Z") }),
    ]);

    expect(result.inserted).toBe(2);
    expect(await store.countScrobbles()).toBe(2);
  });

  it("stores two different tracks scrobbled at the same instant", async () => {
    const store = createMemoryStore();
    const at = new Date("2026-07-20T10:00:00.000Z");

    const result = await ingestPlays(store, [
      play({ track: "Weird Fishes", playedAt: at }),
      play({ track: "Nude", playedAt: at }),
    ]);

    expect(result.inserted).toBe(2);
  });

  it("collapses a play repeated across a page boundary", async () => {
    const store = createMemoryStore();
    const repeated = play({ playedAt: new Date("2026-07-20T10:00:00.000Z") });

    const result = await ingestPlays(store, [repeated, repeated]);

    expect(result.skippedDuplicates).toBe(1);
    expect(result.inserted).toBe(1);
  });
});

describe("the currently-playing entry is never persisted", () => {
  it("drops a play flagged as now playing", () => {
    const batch = toScrobbleRows([
      play({ nowPlaying: true, playedAt: null }),
      play({ playedAt: new Date("2026-07-20T10:00:00.000Z") }),
    ]);

    expect(batch.rows).toHaveLength(1);
    expect(batch.skippedNowPlaying).toBe(1);
  });

  it("drops a play that carries no timestamp even without the flag", () => {
    const batch = toScrobbleRows([play({ nowPlaying: false, playedAt: null })]);

    expect(batch.rows).toHaveLength(0);
    expect(batch.skippedNowPlaying).toBe(1);
  });

  it("does not let a now-playing entry reach the store", async () => {
    const store = createMemoryStore();

    const result = await ingestPlays(store, [
      play({ nowPlaying: true, playedAt: null }),
    ]);

    expect(result.inserted).toBe(0);
    expect(await store.countScrobbles()).toBe(0);
    expect(await store.newestScrobbleAt()).toBeNull();
  });
});

describe("raw display strings survive ingestion", () => {
  it("stores the artist, track and album exactly as last.fm returned them", () => {
    const batch = toScrobbleRows([
      play({
        artist: "Sigur Rós",
        track: "Hoppípolla (2011 Remaster)",
        album: "Takk... (Deluxe Edition)",
      }),
    ]);

    const [row] = batch.rows;
    expect(row.artistName).toBe("Sigur Rós");
    expect(row.trackName).toBe("Hoppípolla (2011 Remaster)");
    expect(row.albumName).toBe("Takk... (Deluxe Edition)");

    // Normalization touched the keys only.
    expect(row.trackKey).toBe(trackKey("Sigur Rós", "Hoppípolla"));
    expect(row.artistKey).toBe("sigur rós");
  });

  it("carries a null album through rather than inventing one", () => {
    const [row] = toScrobbleRows([play({ album: null })]).rows;

    expect(row.albumName).toBeNull();
    expect(row.albumKey).toBeNull();
  });
});

describe("track seeding for the enrichment sweep", () => {
  it("registers each unique track once regardless of play count", async () => {
    const store = createMemoryStore();

    const result = await ingestPlays(store, [
      play({ playedAt: new Date("2026-07-20T10:00:00.000Z") }),
      play({ playedAt: new Date("2026-07-20T11:00:00.000Z") }),
      play({ track: "Nude", playedAt: new Date("2026-07-20T12:00:00.000Z") }),
    ]);

    expect(result.inserted).toBe(3);
    expect(result.newTracks).toBe(2);
    expect(store.tracks.size).toBe(2);
  });

  it("does not re-register a track seen in an earlier batch", async () => {
    const store = createMemoryStore();
    await ingestPlays(store, [
      play({ playedAt: new Date("2026-07-20T10:00:00.000Z") }),
    ]);

    const second = await ingestPlays(store, [
      play({ playedAt: new Date("2026-07-21T10:00:00.000Z") }),
    ]);

    expect(second.newTracks).toBe(0);
  });

  it("keeps the first-seen display spelling for the seed", () => {
    const seeds = toTrackSeeds(
      toScrobbleRows([
        play({ track: "Weird Fishes" }),
        play({
          track: "weird fishes (Remastered)",
          playedAt: new Date("2026-07-20T11:00:00.000Z"),
        }),
      ]).rows,
    );

    expect(seeds).toHaveLength(1);
    expect(seeds[0].trackName).toBe("Weird Fishes");
  });
});

describe("newest stored timestamp", () => {
  it("is null on an empty store, so the poll cannot assume a prior run", async () => {
    expect(await createMemoryStore().newestScrobbleAt()).toBeNull();
  });

  it("reports the latest play regardless of insertion order", async () => {
    const store = createMemoryStore();

    await ingestPlays(store, [
      play({ playedAt: new Date("2026-07-20T10:00:00.000Z") }),
      play({ track: "Nude", playedAt: new Date("2026-07-22T10:00:00.000Z") }),
      play({ track: "Reckoner", playedAt: new Date("2026-07-21T10:00:00.000Z") }),
    ]);

    expect(await store.newestScrobbleAt()).toEqual(
      new Date("2026-07-22T10:00:00.000Z"),
    );
  });
});
