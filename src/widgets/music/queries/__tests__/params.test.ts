import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { seedScrobbles, seedTracks } from "@/test/pglite";
import type { MusicDb } from "../aggregations";
import { recentlyPlayed, summary, topAlbums, topArtists, topTracks } from "../aggregations";

/**
 * What the read path hands the driver, not what it gets back.
 *
 * Every other test in this suite runs against PGlite, which binds parameters
 * in-process and accepts a JavaScript `Date` without complaint. The deployed
 * driver does not: postgres.js writes parameters into a wire-protocol Bind
 * message and throws on anything that is not a string, number, boolean, null,
 * or buffer. That gap is not hypothetical — `summary()` shipped with a raw
 * `sql` template interpolating a `Date`, every round-trip test stayed green,
 * and `/api/music` returned 500 for every view against the real database.
 *
 * A comparison built with `gte()` or `eq()` carries its column, so Drizzle
 * runs the value through that column's encoder and the parameter arrives
 * already serialized. A raw `sql` template has no column to consult and passes
 * the value straight through. That is the one place this can go wrong, so the
 * assertion is on the parameter type rather than on any single query: a future
 * template that interpolates a Date, an array, or a plain object trips it
 * without anyone having to remember this failure.
 */

const PRIMITIVE = ["string", "number", "boolean"];

/** Mirrors what postgres.js is willing to write into a Bind message. */
function isBindable(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (PRIMITIVE.includes(typeof value)) return true;
  return value instanceof Uint8Array;
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Date) return `Date(${value.toISOString()})`;
  if (Array.isArray(value)) return "Array";
  return `${typeof value} ${Object.prototype.toString.call(value)}`;
}

let client: PGlite;
let db: MusicDb;
let bound: unknown[];

beforeEach(async () => {
  client = new PGlite();
  bound = [];
  db = drizzle(client, {
    schema,
    logger: {
      logQuery: (_query, params) => {
        bound.push(...params);
      },
    },
  }) as unknown as MusicDb;

  await migrate(db as never, { migrationsFolder: "./drizzle" });

  await seedScrobbles(db, [
    {
      artist: "Boards of Canada",
      track: "Roygbiv",
      album: "Music Has the Right",
      playedAt: new Date("2026-07-20T12:00:00Z"),
    },
  ]);
  await seedTracks(db, [
    {
      artist: "Boards of Canada",
      track: "Roygbiv",
      album: "Music Has the Right",
      durationMs: 176_000,
    },
  ]);

  // Migrations and seeding bind plenty of values through paths the read path
  // does not use. Only the queries under test are the subject here.
  bound.length = 0;
});

afterEach(async () => {
  await client.close();
});

function expectAllBindable() {
  const offenders = bound.filter((value) => !isBindable(value));
  expect(
    offenders.map(describeValue),
    "parameters postgres.js cannot write into a Bind message",
  ).toEqual([]);
}

describe("bound parameters", () => {
  const now = new Date("2026-07-21T00:00:00Z");

  it("binds only wire-protocol primitives for the summary", async () => {
    await summary({ db, now });
    // Guards the regression directly: the week boundary reaches the driver
    // through a raw template, so nothing else would catch a Date here.
    expect(bound.length).toBeGreaterThan(0);
    expectAllBindable();
  });

  it("binds only wire-protocol primitives for the ranged tallies", async () => {
    await topArtists("week", { db, now });
    await topAlbums("week", { db, now });
    await topTracks("week", { db, now });
    // These bind their lower bound through `gte()`, which supplies the column
    // encoder. They should already pass — which is the point: it shows the
    // assertion is not vacuously true only for the query that was fixed.
    expect(bound.length).toBeGreaterThan(0);
    expectAllBindable();
  });

  it("binds only wire-protocol primitives for a query with no date bound", async () => {
    await recentlyPlayed({ db, limit: 10 });
    expectAllBindable();
  });

  it("binds nothing unserializable for an all-time range", async () => {
    // `windowStart` returns null for "all", so the range predicate drops out
    // entirely. Covered so the assertion is exercised on the branch that binds
    // the fewest parameters.
    await topArtists("all", { db, now });
    expectAllBindable();
  });
});
