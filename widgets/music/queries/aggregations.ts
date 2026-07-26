import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { musicScrobble, musicTrack } from "@/lib/db/schema";
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
      plays: count().as("plays"),
    })
    .from(musicScrobble)
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

export async function summary({
  db = getDb(),
  now = new Date(),
}: Omit<QueryOptions, "limit"> = {}): Promise<MusicSummary> {
  const weekStart = windowStart("week", now)!;

  const [totals] = await db
    .select({
      totalScrobbles: count(),
      uniqueArtists: sql<number>`count(distinct ${musicScrobble.artistKey})`,
      uniqueTracks: sql<number>`count(distinct ${musicScrobble.trackKey})`,
      firstScrobbleAt: sql<Date | null>`min(${musicScrobble.playedAt})`,
      lastScrobbleAt: sql<Date | null>`max(${musicScrobble.playedAt})`,
    })
    .from(musicScrobble);

  const [week] = await db
    .select({ plays: count() })
    .from(musicScrobble)
    .where(gte(musicScrobble.playedAt, weekStart));

  // Inner join plus a not-null filter is what excludes unresolved tracks from
  // the total rather than estimating them (R24, AE4).
  const [minutes] = await db
    .select({
      totalMs: sql<string | null>`sum(${musicTrack.durationMs})`,
    })
    .from(musicScrobble)
    .innerJoin(musicTrack, eq(musicTrack.trackKey, musicScrobble.trackKey))
    .where(isNotNull(musicTrack.durationMs));

  const [unresolved] = await db
    .select({ plays: count() })
    .from(musicScrobble)
    .leftJoin(musicTrack, eq(musicTrack.trackKey, musicScrobble.trackKey))
    .where(sql`${musicTrack.durationMs} is null`);

  const scrobblesThisWeek = Number(week?.plays ?? 0);

  return {
    scrobblesThisWeek,
    perDayAverage: Math.round((scrobblesThisWeek / 7) * 10) / 10,
    totalScrobbles: Number(totals?.totalScrobbles ?? 0),
    uniqueArtists: Number(totals?.uniqueArtists ?? 0),
    uniqueTracks: Number(totals?.uniqueTracks ?? 0),
    listeningMinutes: Math.round(Number(minutes?.totalMs ?? 0) / 60_000),
    playsWithoutDuration: Number(unresolved?.plays ?? 0),
    firstScrobbleAt: totals?.firstScrobbleAt ? new Date(totals.firstScrobbleAt) : null,
    lastScrobbleAt: totals?.lastScrobbleAt ? new Date(totals.lastScrobbleAt) : null,
  };
}
