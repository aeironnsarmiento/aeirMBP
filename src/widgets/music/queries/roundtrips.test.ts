import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { seedScrobbles, seedTracks } from "@/test/pglite";
import type { MusicDb } from "./aggregations";
import { summary, topAlbums, topArtists, topTracks, recentlyPlayed } from "./aggregations";

/**
 * Round-trip budget for the read path.
 *
 * These assertions look pedantic against an in-process database, where an
 * extra statement costs microseconds. They are not about the database: the
 * production connection goes through Supabase's pooler in us-east-1, where a
 * statement costs ~43 ms in network latency no matter how trivial it is. At
 * that price the statement *count* is the read path's performance, and it is
 * the one property no other test in this suite would notice regressing —
 * `summary()` split back into four queries would keep every existing test
 * green while tripling the panel's load time.
 *
 * `scripts/db-audit.mjs` models the same read path to time it. These counts
 * are what keep that model honest.
 */

let client: PGlite;
let db: MusicDb;
let statements: string[];

beforeEach(async () => {
  client = new PGlite();
  statements = [];
  db = drizzle(client, {
    schema,
    logger: { logQuery: (query) => statements.push(query) },
  }) as unknown as MusicDb;

  await migrate(db as never, { migrationsFolder: "./drizzle" });
  statements.length = 0; // migrations are not part of the read path

  const playedAt = new Date("2026-07-20T12:00:00Z");
  await seedScrobbles(db, [
    { artist: "Boards of Canada", track: "Roygbiv", album: "Music Has the Right", playedAt },
    { artist: "Boards of Canada", track: "Olson", album: "Music Has the Right", playedAt: new Date("2026-07-20T12:05:00Z") },
  ]);
  await seedTracks(db, [
    { artist: "Boards of Canada", track: "Roygbiv", album: "Music Has the Right", durationMs: 176000 },
  ]);
  statements.length = 0; // nor is seeding
});

afterEach(async () => {
  await client.close();
});

describe("read path round trips", () => {
  it("computes the whole summary in one statement", async () => {
    await summary({ db, now: new Date("2026-07-21T00:00:00Z") });
    expect(statements).toHaveLength(1);
  });

  it.each([
    ["topArtists", () => topArtists("week", { db })],
    ["topAlbums", () => topAlbums("week", { db })],
    ["topTracks", () => topTracks("week", { db })],
    ["recentlyPlayed", () => recentlyPlayed({ db })],
  ])("serves %s in one statement", async (_name, run) => {
    await run();
    expect(statements).toHaveLength(1);
  });

  it("costs two statements for a full /api/music response", async () => {
    // What the handler issues: one view query and one summary, concurrently.
    await Promise.all([topArtists("week", { db }), summary({ db })]);
    expect(statements).toHaveLength(2);
  });

  it("still reports every summary field from the single statement", async () => {
    const result = await summary({ db, now: new Date("2026-07-21T00:00:00Z") });

    // One of the two plays has a resolved duration; the other does not.
    expect(result.totalScrobbles).toBe(2);
    expect(result.uniqueArtists).toBe(1);
    expect(result.uniqueTracks).toBe(2);
    expect(result.listeningMinutes).toBe(3);
    expect(result.playsWithoutDuration).toBe(1);
    expect(result.scrobblesThisWeek).toBe(2);
    expect(result.firstScrobbleAt).toEqual(new Date("2026-07-20T12:00:00Z"));
    expect(result.lastScrobbleAt).toEqual(new Date("2026-07-20T12:05:00Z"));
  });
});
