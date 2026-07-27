import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { musicArtist, musicScrobble, musicTrack } from "@/lib/db/schema";
import { windowStart, type TimeRange } from "./ranges";

/**
 * The music widget's read layer (R25, R26, R27, R28).
 *
 * Every query here reads `music_*` and nothing else (R15), and every one is
 * served entirely from local storage — no aggregate view issues an outbound
 * last.fm call, which is what keeps the widget working when last.fm is down
 * (AE8). The freshness-critical surfaces live in `server/now.ts` instead.
 *
 * Grouping is always on the normalized key from U9; display always reads the
 * raw strings, resolved with `mode()` so the most common client spelling wins
 * rather than an arbitrary one.
 */

export type MusicDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export * from "./ranges";

type QueryOptions = {
  db?: MusicDb;
  now?: Date;
  limit?: number;
};

function withinRange(range: TimeRange, now: Date) {
  const start = windowStart(range, now);
  return start ? gte(musicScrobble.playedAt, start) : undefined;
}

/** Most common raw spelling for a group, so display never picks arbitrarily. */
const commonSpelling = (column: unknown) =>
  sql<string>`mode() within group (order by ${column})`;

export type ArtistTally = {
  artistKey: string;
  artistName: string;
  artworkUrl: string | null;
  plays: number;
};

export async function topArtists(
  range: TimeRange,
  { db = getDb(), now = new Date(), limit = 50 }: QueryOptions = {},
): Promise<ArtistTally[]> {
  const rows = await db
    .select({
      artistKey: musicScrobble.artistKey,
      artistName: commonSpelling(musicScrobble.artistName),
      // The artist's own portrait when the sweep has found one, falling back
      // to the cover of their most-played record and then to initials (R22).
      // `mode()` ignores nulls, so a part-enriched artist still gets an image.
      artworkUrl: sql<string | null>`coalesce(
        mode() within group (order by ${musicArtist.pictureUrl}),
        mode() within group (order by ${musicTrack.artworkUrl})
      )`,
      plays: count().as("plays"),
    })
    .from(musicScrobble)
    // Both keys are primary keys on their tables, so neither join can fan a
    // scrobble out into several rows and inflate the tally.
    .leftJoin(musicTrack, eq(musicTrack.trackKey, musicScrobble.trackKey))
    .leftJoin(musicArtist, eq(musicArtist.artistKey, musicScrobble.artistKey))
    .where(withinRange(range, now))
    .groupBy(musicScrobble.artistKey)
    // artistKey is the tie-break, so equal play counts order identically on
    // every call rather than however the planner happened to emit them.
    .orderBy(sql`count(*) desc`, musicScrobble.artistKey)
    .limit(limit);

  return rows.map((row) => ({ ...row, plays: Number(row.plays) }));
}

export type AlbumTally = {
  albumKey: string;
  albumName: string;
  artistName: string;
  artworkUrl: string | null;
  plays: number;
};

export async function topAlbums(
  range: TimeRange,
  { db = getDb(), now = new Date(), limit = 50 }: QueryOptions = {},
): Promise<AlbumTally[]> {
  const rows = await db
    .select({
      albumKey: sql<string>`${musicScrobble.albumKey}`,
      albumName: commonSpelling(musicScrobble.albumName),
      artistName: commonSpelling(musicScrobble.artistName),
      // Any resolved cover from a track on the album stands in for the album.
      artworkUrl: sql<
        string | null
      >`mode() within group (order by ${musicTrack.artworkUrl})`,
      plays: count().as("plays"),
    })
    .from(musicScrobble)
    .leftJoin(musicTrack, eq(musicTrack.trackKey, musicScrobble.trackKey))
    .where(and(isNotNull(musicScrobble.albumKey), withinRange(range, now)))
    .groupBy(musicScrobble.albumKey)
    .orderBy(sql`count(*) desc`, musicScrobble.albumKey)
    .limit(limit);

  return rows.map((row) => ({ ...row, plays: Number(row.plays) }));
}

export type TrackTally = {
  trackKey: string;
  trackName: string;
  artistName: string;
  albumName: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
  plays: number;
};

export async function topTracks(
  range: TimeRange,
  { db = getDb(), now = new Date(), limit = 50 }: QueryOptions = {},
): Promise<TrackTally[]> {
  const rows = await db
    .select({
      trackKey: musicScrobble.trackKey,
      trackName: commonSpelling(musicScrobble.trackName),
      artistName: commonSpelling(musicScrobble.artistName),
      albumName: commonSpelling(musicScrobble.albumName),
      artworkUrl: sql<
        string | null
      >`mode() within group (order by ${musicTrack.artworkUrl})`,
      durationMs: sql<
        number | null
      >`mode() within group (order by ${musicTrack.durationMs})`,
      plays: count().as("plays"),
    })
    .from(musicScrobble)
    .leftJoin(musicTrack, eq(musicTrack.trackKey, musicScrobble.trackKey))
    .where(withinRange(range, now))
    .groupBy(musicScrobble.trackKey)
    .orderBy(sql`count(*) desc`, musicScrobble.trackKey)
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    plays: Number(row.plays),
    durationMs: row.durationMs === null ? null : Number(row.durationMs),
  }));
}

export type RecentPlay = {
  trackName: string;
  artistName: string;
  albumName: string | null;
  artworkUrl: string | null;
  playedAt: Date;
};

/** The local fallback behind the live recently-played surface (AE8). */
export async function recentlyPlayed({
  db = getDb(),
  limit = 50,
}: Omit<QueryOptions, "now"> = {}): Promise<RecentPlay[]> {
  return db
    .select({
      trackName: musicScrobble.trackName,
      artistName: musicScrobble.artistName,
      albumName: musicScrobble.albumName,
      artworkUrl: musicTrack.artworkUrl,
      playedAt: musicScrobble.playedAt,
    })
    .from(musicScrobble)
    .leftJoin(musicTrack, eq(musicTrack.trackKey, musicScrobble.trackKey))
    .orderBy(desc(musicScrobble.playedAt), desc(musicScrobble.id))
    .limit(limit);
}

export type MusicSummary = {
  /** Leads the presentation: rate, not lifetime volume (R28). */
  scrobblesThisWeek: number;
  perDayAverage: number;
  totalScrobbles: number;
  uniqueArtists: number;
  uniqueTracks: number;
  /** Derived from resolved durations only. Unmatched tracks are excluded (R24). */
  listeningMinutes: number;
  /** How many plays that total leaves out, so the figure can be stated honestly. */
  playsWithoutDuration: number;
  firstScrobbleAt: Date | null;
  lastScrobbleAt: Date | null;
};

/**
 * One scan of `music_scrobble`, not four.
 *
 * Every figure on this panel derives from the same set of rows joined to the
 * same track table, so `filter (where …)` computes all of them in a single
 * pass. As four separate statements this was the read path's dominant cost:
 * the database work is a couple of milliseconds either way, but each statement
 * is its own round trip to the pooler, and those are ~43 ms each from a
 * serverless invocation.
 *
 * The join stays a LEFT JOIN even though the minutes total wants only matched
 * rows. `sum()` skips nulls, so an unmatched scrobble contributes nothing to
 * the total exactly as the inner join intended (R24, AE4) — and the same join
 * can then count those unmatched plays, which an inner join has already
 * discarded. `track_key` is `music_track`'s primary key, so the join cannot
 * fan a scrobble out into several rows and inflate `count(*)`.
 */
export async function summary({
  db = getDb(),
  now = new Date(),
}: Omit<QueryOptions, "limit"> = {}): Promise<MusicSummary> {
  /*
   * Serialized here rather than passed as a Date.
   *
   * A comparison built with `gte()` carries the column with it, so Drizzle
   * knows to run the value through that column's encoder. A raw `sql` template
   * has no column to consult: whatever is interpolated is handed to the driver
   * as-is, and postgres.js cannot write a Date into a Bind message — it fails
   * with `The "string" argument must be of type string ... Received an
   * instance of Date` at parameter-description time, which surfaces as a
   * failed query rather than a type error.
   *
   * Postgres infers the parameter's type from the comparison, so an ISO string
   * is read as timestamptz against `played_at`.
   */
  const weekStart = windowStart("week", now)!.toISOString();

  const [row] = await db
    .select({
      totalScrobbles: count(),
      uniqueArtists: sql<number>`count(distinct ${musicScrobble.artistKey})`,
      uniqueTracks: sql<number>`count(distinct ${musicScrobble.trackKey})`,
      firstScrobbleAt: sql<Date | null>`min(${musicScrobble.playedAt})`,
      lastScrobbleAt: sql<Date | null>`max(${musicScrobble.playedAt})`,
      scrobblesThisWeek: sql<number>`count(*) filter (
        where ${musicScrobble.playedAt} >= ${weekStart}
      )`,
      totalMs: sql<string | null>`sum(${musicTrack.durationMs})`,
      playsWithoutDuration: sql<number>`count(*) filter (
        where ${musicTrack.durationMs} is null
      )`,
    })
    .from(musicScrobble)
    .leftJoin(musicTrack, eq(musicTrack.trackKey, musicScrobble.trackKey));

  const scrobblesThisWeek = Number(row?.scrobblesThisWeek ?? 0);

  return {
    scrobblesThisWeek,
    perDayAverage: Math.round((scrobblesThisWeek / 7) * 10) / 10,
    totalScrobbles: Number(row?.totalScrobbles ?? 0),
    uniqueArtists: Number(row?.uniqueArtists ?? 0),
    uniqueTracks: Number(row?.uniqueTracks ?? 0),
    listeningMinutes: Math.round(Number(row?.totalMs ?? 0) / 60_000),
    playsWithoutDuration: Number(row?.playsWithoutDuration ?? 0),
    firstScrobbleAt: row?.firstScrobbleAt ? new Date(row.firstScrobbleAt) : null,
    lastScrobbleAt: row?.lastScrobbleAt ? new Date(row.lastScrobbleAt) : null,
  };
}
