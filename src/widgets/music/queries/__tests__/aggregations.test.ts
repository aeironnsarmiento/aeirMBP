// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { musicArtist, musicScrobble, musicTrack } from "@/lib/db/schema";
import { createTestDb, seedScrobbles, seedTracks } from "@/test/pglite";
import {
  recentlyPlayed,
  summary,
  topAlbums,
  topArtists,
  topTracks,
  windowStart,
  type MusicDb,
} from "../aggregations";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

let db: MusicDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.delete(musicScrobble);
  await db.delete(musicTrack);
  await db.delete(musicArtist);
});

describe("top artists", () => {
  it("excludes scrobbles outside the week window", async () => {
    await seedScrobbles(db, [
      { artist: "Recent Band", track: "A", playedAt: daysAgo(2) },
      { artist: "Recent Band", track: "A", playedAt: daysAgo(3) },
      { artist: "Old Band", track: "B", playedAt: daysAgo(20) },
      { artist: "Ancient Band", track: "C", playedAt: daysAgo(200) },
    ]);

    const week = await topArtists("week", { db, now: NOW });

    expect(week.map((row) => row.artistName)).toEqual(["Recent Band"]);
    expect(week[0].plays).toBe(2);
  });

  it("includes the month window and excludes what falls outside it", async () => {
    await seedScrobbles(db, [
      { artist: "Recent Band", track: "A", playedAt: daysAgo(2) },
      { artist: "Old Band", track: "B", playedAt: daysAgo(20) },
      { artist: "Ancient Band", track: "C", playedAt: daysAgo(200) },
    ]);

    const month = await topArtists("month", { db, now: NOW });

    expect(month.map((row) => row.artistName).sort()).toEqual([
      "Old Band",
      "Recent Band",
    ]);
  });

  it("includes every stored scrobble for all time", async () => {
    await seedScrobbles(db, [
      { artist: "Recent Band", track: "A", playedAt: daysAgo(2) },
      { artist: "Ancient Band", track: "C", playedAt: daysAgo(2000) },
    ]);

    expect(await topArtists("all", { db, now: NOW })).toHaveLength(2);
  });

  it("groups differing client spellings of one artist together", async () => {
    await seedScrobbles(db, [
      { artist: "Sigur Rós", track: "Hoppípolla", playedAt: daysAgo(1) },
      { artist: "sigur  rós", track: "Hoppípolla", playedAt: daysAgo(2) },
      { artist: "SIGUR RÓS", track: "Hoppípolla", playedAt: daysAgo(3) },
    ]);

    const rows = await topArtists("all", { db, now: NOW });

    expect(rows).toHaveLength(1);
    expect(rows[0].plays).toBe(3);
  });

  it("displays the most common raw spelling, not an arbitrary one", async () => {
    await seedScrobbles(db, [
      { artist: "Sigur Rós", track: "A", playedAt: daysAgo(1) },
      { artist: "Sigur Rós", track: "B", playedAt: daysAgo(2) },
      { artist: "SIGUR RÓS", track: "C", playedAt: daysAgo(3) },
    ]);

    expect((await topArtists("all", { db, now: NOW }))[0].artistName).toBe(
      "Sigur Rós",
    );
  });

  it("orders ties deterministically", async () => {
    await seedScrobbles(db, [
      { artist: "Zeta", track: "A", playedAt: daysAgo(1) },
      { artist: "Alpha", track: "B", playedAt: daysAgo(2) },
      { artist: "Mid", track: "C", playedAt: daysAgo(3) },
    ]);

    const first = (await topArtists("all", { db, now: NOW })).map((r) => r.artistKey);
    const second = (await topArtists("all", { db, now: NOW })).map((r) => r.artistKey);

    expect(first).toEqual(["alpha", "mid", "zeta"]);
    expect(second).toEqual(first);
  });

  it("returns an empty list for a window with nothing in it", async () => {
    await seedScrobbles(db, [
      { artist: "Ancient Band", track: "C", playedAt: daysAgo(200) },
    ]);

    expect(await topArtists("week", { db, now: NOW })).toEqual([]);
  });

  it("returns an empty list against an empty store", async () => {
    expect(await topArtists("all", { db, now: NOW })).toEqual([]);
  });

  it("prefers the artist's own portrait over any record cover (R21)", async () => {
    await seedTracks(db, [
      {
        artist: "Ado",
        track: "Ibara",
        artworkUrl: "https://cdn.example/ibara-album.jpg",
      },
    ]);
    await db.insert(musicArtist).values({
      artistKey: "ado",
      artistName: "Ado",
      pictureUrl: "https://cdn.example/ado-portrait.jpg",
      source: "deezer",
      enrichedAt: new Date(),
      attemptedAt: new Date(),
    });
    await seedScrobbles(db, [
      { artist: "Ado", track: "Ibara", playedAt: daysAgo(1) },
    ]);

    const [row] = await topArtists("all", { db, now: NOW });

    expect(row.artworkUrl).toBe("https://cdn.example/ado-portrait.jpg");
  });

  it("falls back to a record cover when the portrait lookup missed", async () => {
    await seedTracks(db, [
      {
        artist: "Ado",
        track: "Ibara",
        artworkUrl: "https://cdn.example/ibara-album.jpg",
      },
    ]);
    // Attempted, no picture — the shape a miss leaves behind.
    await db.insert(musicArtist).values({
      artistKey: "ado",
      artistName: "Ado",
      attemptedAt: new Date(),
    });
    await seedScrobbles(db, [
      { artist: "Ado", track: "Ibara", playedAt: daysAgo(1) },
    ]);

    const [row] = await topArtists("all", { db, now: NOW });

    expect(row.artworkUrl).toBe("https://cdn.example/ibara-album.jpg");
  });

  it("does not inflate the tally by joining the artist table", async () => {
    await db.insert(musicArtist).values({
      artistKey: "ado",
      artistName: "Ado",
      pictureUrl: "https://cdn.example/ado-portrait.jpg",
      enrichedAt: new Date(),
      attemptedAt: new Date(),
    });
    await seedScrobbles(db, [
      { artist: "Ado", track: "A", playedAt: daysAgo(1) },
      { artist: "Ado", track: "B", playedAt: daysAgo(2) },
      { artist: "Ado", track: "C", playedAt: daysAgo(3) },
    ]);

    const [row] = await topArtists("all", { db, now: NOW });

    expect(row.plays).toBe(3);
  });

  it("carries the cover of the artist's most-played track when no portrait exists", async () => {
    await seedTracks(db, [
      {
        artist: "Ado",
        track: "Ibara",
        artworkUrl: "https://cdn.example/ibara.jpg",
      },
      {
        artist: "Ado",
        track: "Vivarium",
        artworkUrl: "https://cdn.example/vivarium.jpg",
      },
    ]);
    await seedScrobbles(db, [
      { artist: "Ado", track: "Ibara", playedAt: daysAgo(1) },
      { artist: "Ado", track: "Ibara", playedAt: daysAgo(2) },
      { artist: "Ado", track: "Ibara", playedAt: daysAgo(3) },
      { artist: "Ado", track: "Vivarium", playedAt: daysAgo(4) },
    ]);

    const [row] = await topArtists("all", { db, now: NOW });

    expect(row.plays).toBe(4);
    expect(row.artworkUrl).toBe("https://cdn.example/ibara.jpg");
  });

  it("leaves artwork null when no play of the artist is enriched (R22)", async () => {
    await seedScrobbles(db, [
      { artist: "Obscure", track: "Bootleg", playedAt: daysAgo(1) },
    ]);

    const [row] = await topArtists("all", { db, now: NOW });

    expect(row.artistName).toBe("Obscure");
    expect(row.artworkUrl).toBeNull();
  });

  it("prefers a matched cover over the unmatched majority", async () => {
    await seedTracks(db, [
      {
        artist: "Half Known",
        track: "Matched",
        artworkUrl: "https://cdn.example/only-one.jpg",
      },
    ]);
    await seedScrobbles(db, [
      { artist: "Half Known", track: "Unmatched A", playedAt: daysAgo(1) },
      { artist: "Half Known", track: "Unmatched B", playedAt: daysAgo(2) },
      { artist: "Half Known", track: "Matched", playedAt: daysAgo(3) },
    ]);

    const [row] = await topArtists("all", { db, now: NOW });

    expect(row.plays).toBe(3);
    expect(row.artworkUrl).toBe("https://cdn.example/only-one.jpg");
  });

  it("still bounds the window after the artwork join", async () => {
    await seedTracks(db, [
      {
        artist: "Old Band",
        track: "B",
        artworkUrl: "https://cdn.example/old.jpg",
      },
    ]);
    await seedScrobbles(db, [
      { artist: "Recent Band", track: "A", playedAt: daysAgo(2) },
      { artist: "Old Band", track: "B", playedAt: daysAgo(20) },
    ]);

    const week = await topArtists("week", { db, now: NOW });

    expect(week.map((row) => row.artistName)).toEqual(["Recent Band"]);
  });
});

describe("top albums", () => {
  it("groups by album and carries artwork from an enriched track", async () => {
    await seedTracks(db, [
      {
        artist: "Radiohead",
        track: "Weird Fishes",
        album: "In Rainbows",
        artworkUrl: "https://cdn.example/in-rainbows.jpg",
      },
    ]);
    await seedScrobbles(db, [
      {
        artist: "Radiohead",
        track: "Weird Fishes",
        album: "In Rainbows",
        playedAt: daysAgo(1),
      },
      {
        artist: "Radiohead",
        track: "Weird Fishes",
        album: "In Rainbows (Deluxe Edition)",
        playedAt: daysAgo(2),
      },
    ]);

    const rows = await topAlbums("all", { db, now: NOW });

    expect(rows).toHaveLength(1);
    expect(rows[0].plays).toBe(2);
    expect(rows[0].artworkUrl).toBe("https://cdn.example/in-rainbows.jpg");
  });

  it("omits scrobbles that carry no album rather than inventing a group", async () => {
    await seedScrobbles(db, [
      { artist: "Radiohead", track: "Nude", album: null, playedAt: daysAgo(1) },
      {
        artist: "Radiohead",
        track: "Weird Fishes",
        album: "In Rainbows",
        playedAt: daysAgo(2),
      },
    ]);

    const rows = await topAlbums("all", { db, now: NOW });

    expect(rows).toHaveLength(1);
    expect(rows[0].albumName).toBe("In Rainbows");
  });

  it("leaves artwork null when no track on the album is enriched", async () => {
    await seedScrobbles(db, [
      {
        artist: "Obscure",
        track: "Bootleg",
        album: "Tape",
        playedAt: daysAgo(1),
      },
    ]);

    expect((await topAlbums("all", { db, now: NOW }))[0].artworkUrl).toBeNull();
  });
});

describe("top tracks", () => {
  it("sums plays of one track across differing client spellings", async () => {
    await seedScrobbles(db, [
      { artist: "Nirvana", track: "Come As You Are", playedAt: daysAgo(1) },
      {
        artist: "Nirvana",
        track: "Come As You Are - 2011 Remaster",
        playedAt: daysAgo(2),
      },
      {
        artist: "Nirvana",
        track: "come as you are (Remastered)",
        playedAt: daysAgo(3),
      },
    ]);

    const rows = await topTracks("all", { db, now: NOW });

    expect(rows).toHaveLength(1);
    expect(rows[0].plays).toBe(3);
  });

  it("carries duration and artwork through from the enriched track", async () => {
    await seedTracks(db, [
      {
        artist: "Radiohead",
        track: "Weird Fishes",
        durationMs: 321_000,
        artworkUrl: "https://cdn.example/cover.jpg",
      },
    ]);
    await seedScrobbles(db, [
      { artist: "Radiohead", track: "Weird Fishes", playedAt: daysAgo(1) },
    ]);

    const [row] = await topTracks("all", { db, now: NOW });

    expect(row.durationMs).toBe(321_000);
    expect(row.artworkUrl).toBe("https://cdn.example/cover.jpg");
  });

  it("renders an unenriched track rather than dropping it", async () => {
    await seedScrobbles(db, [
      { artist: "Obscure", track: "Bootleg", playedAt: daysAgo(1) },
    ]);

    const [row] = await topTracks("all", { db, now: NOW });

    expect(row.trackName).toBe("Bootleg");
    expect(row.durationMs).toBeNull();
    expect(row.artworkUrl).toBeNull();
  });

  it("respects the requested limit", async () => {
    await seedScrobbles(
      db,
      Array.from({ length: 10 }, (_, n) => ({
        artist: "Band",
        track: `Track ${n}`,
        playedAt: daysAgo(n + 1),
      })),
    );

    expect(await topTracks("all", { db, now: NOW, limit: 3 })).toHaveLength(3);
  });
});

describe("recently played", () => {
  it("orders newest first", async () => {
    await seedScrobbles(db, [
      { artist: "Band", track: "Oldest", playedAt: daysAgo(3) },
      { artist: "Band", track: "Newest", playedAt: daysAgo(1) },
      { artist: "Band", track: "Middle", playedAt: daysAgo(2) },
    ]);

    expect((await recentlyPlayed({ db })).map((row) => row.trackName)).toEqual([
      "Newest",
      "Middle",
      "Oldest",
    ]);
  });

  it("returns an empty list against an empty store", async () => {
    expect(await recentlyPlayed({ db })).toEqual([]);
  });
});

describe("summary (R28, R24)", () => {
  it("excludes plays of tracks with unresolved duration from the total (AE4)", async () => {
    await seedTracks(db, [
      { artist: "Band", track: "Resolved", durationMs: 300_000 },
      { artist: "Band", track: "Unresolved", durationMs: null },
    ]);
    await seedScrobbles(db, [
      { artist: "Band", track: "Resolved", playedAt: daysAgo(1) },
      { artist: "Band", track: "Resolved", playedAt: daysAgo(2) },
      { artist: "Band", track: "Unresolved", playedAt: daysAgo(1) },
    ]);

    const result = await summary({ db, now: NOW });

    // 2 plays x 5 minutes. The unresolved play contributes nothing rather than
    // an estimate.
    expect(result.listeningMinutes).toBe(10);
    expect(result.playsWithoutDuration).toBe(1);
    expect(result.totalScrobbles).toBe(3);
  });

  it("counts a play whose track was never registered as missing a duration", async () => {
    await seedScrobbles(db, [
      { artist: "Band", track: "Never Seeded", playedAt: daysAgo(1) },
    ]);

    const result = await summary({ db, now: NOW });

    expect(result.listeningMinutes).toBe(0);
    expect(result.playsWithoutDuration).toBe(1);
  });

  it("leads with this week's rate rather than the lifetime total", async () => {
    await seedScrobbles(db, [
      ...Array.from({ length: 14 }, (_, n) => ({
        artist: "Band",
        track: `Recent ${n}`,
        playedAt: daysAgo(1),
      })),
      ...Array.from({ length: 100 }, (_, n) => ({
        artist: "Band",
        track: `Old ${n}`,
        playedAt: daysAgo(60),
      })),
    ]);

    const result = await summary({ db, now: NOW });

    expect(result.scrobblesThisWeek).toBe(14);
    expect(result.perDayAverage).toBe(2);
    expect(result.totalScrobbles).toBe(114);
  });

  it("reports zeroes rather than erroring against an empty store", async () => {
    const result = await summary({ db, now: NOW });

    expect(result).toMatchObject({
      scrobblesThisWeek: 0,
      perDayAverage: 0,
      totalScrobbles: 0,
      uniqueArtists: 0,
      uniqueTracks: 0,
      listeningMinutes: 0,
      firstScrobbleAt: null,
    });
  });

  it("counts unique artists and tracks by normalized key", async () => {
    await seedScrobbles(db, [
      { artist: "Sigur Rós", track: "Hoppípolla", playedAt: daysAgo(1) },
      { artist: "SIGUR RÓS", track: "hoppípolla", playedAt: daysAgo(2) },
      { artist: "Sigur Rós", track: "Glósóli", playedAt: daysAgo(3) },
    ]);

    const result = await summary({ db, now: NOW });

    expect(result.uniqueArtists).toBe(1);
    expect(result.uniqueTracks).toBe(2);
  });
});

describe("no aggregate view reaches last.fm (AE8)", () => {
  it("issues no network call while rendering every aggregate surface", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);

    await seedScrobbles(db, [
      { artist: "Band", track: "A", album: "Album", playedAt: daysAgo(1) },
    ]);

    await topArtists("week", { db, now: NOW });
    await topAlbums("month", { db, now: NOW });
    await topTracks("all", { db, now: NOW });
    await recentlyPlayed({ db });
    await summary({ db, now: NOW });

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("window boundaries", () => {
  it("computes the lower bound for each range", () => {
    expect(windowStart("week", NOW)).toEqual(daysAgo(7));
    expect(windowStart("month", NOW)).toEqual(daysAgo(30));
    expect(windowStart("all", NOW)).toBeNull();
  });
});
