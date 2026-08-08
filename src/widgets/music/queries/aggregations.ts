import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { musicArtist, musicScrobble, musicTrack } from "@/lib/db/schema";
import { windowStart, type TimeRange } from "./ranges";

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
      artworkUrl: sql<string | null>`coalesce(
        mode() within group (order by ${musicArtist.pictureUrl}),
        mode() within group (order by ${musicTrack.artworkUrl})
      )`,
      plays: count().as("plays"),
    })
    .from(musicScrobble)
    .leftJoin(musicTrack, eq(musicTrack.trackKey, musicScrobble.trackKey))
    .leftJoin(musicArtist, eq(musicArtist.artistKey, musicScrobble.artistKey))
    .where(withinRange(range, now))
    .groupBy(musicScrobble.artistKey)
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
  scrobblesThisWeek: number;
  perDayAverage: number;
  totalScrobbles: number;
  uniqueArtists: number;
  uniqueTracks: number;
  listeningMinutes: number;
  playsWithoutDuration: number;
  firstScrobbleAt: Date | null;
  lastScrobbleAt: Date | null;
};

export async function summary({
  db = getDb(),
  now = new Date(),
}: Omit<QueryOptions, "limit"> = {}): Promise<MusicSummary> {

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
