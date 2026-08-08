import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { musicScrobble, musicTrack } from "@/lib/db/schema";
import { getRecentTracks, type LastfmPlay } from "../lastfm/client";

export type NowPlaying = {
  track: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
  live: boolean;
  playedAt: string | null;
  source: "lastfm" | "local";
};

export const CACHE_TTL_MS = 20_000;
export const LASTFM_TIMEOUT_MS = 2_500;
export const CATCH_UP_LIMIT = 50;

type CacheEntry = {
  value: NowPlaying | null;
  plays: readonly LastfmPlay[];
  ingested: boolean;
  expiresAt: number;
};
let cache: CacheEntry | null = null;

export function clearNowPlayingCache(): void {
  cache = null;
}

export type NowDeps = {
  fetchRecent?: () => Promise<LastfmPlay[]>;
  readLatestStored?: () => Promise<NowPlaying | null>;
  onFreshPlays?: (plays: readonly LastfmPlay[]) => Promise<void> | void;
  now?: () => number;
  ttlMs?: number;
};

async function defaultFetchRecent(): Promise<LastfmPlay[]> {
  const page = await getRecentTracks(
    { limit: CATCH_UP_LIMIT },
    { attempts: 1, signal: AbortSignal.timeout(LASTFM_TIMEOUT_MS) },
  );
  return page.plays;
}

async function defaultReadLatestStored(): Promise<NowPlaying | null> {
  const [row] = await getDb()
    .select({
      track: musicScrobble.trackName,
      artist: musicScrobble.artistName,
      album: musicScrobble.albumName,
      artworkUrl: musicTrack.artworkUrl,
      playedAt: musicScrobble.playedAt,
    })
    .from(musicScrobble)
    .leftJoin(musicTrack, eq(musicTrack.trackKey, musicScrobble.trackKey))
    .orderBy(desc(musicScrobble.playedAt))
    .limit(1);

  if (!row) return null;

  return {
    track: row.track,
    artist: row.artist,
    album: row.album,
    artworkUrl: row.artworkUrl,
    live: false,
    playedAt: row.playedAt.toISOString(),
    source: "local",
  };
}

export async function readNowPlaying({
  fetchRecent = defaultFetchRecent,
  readLatestStored = defaultReadLatestStored,
  onFreshPlays,
  now = Date.now,
  ttlMs = CACHE_TTL_MS,
}: NowDeps = {}): Promise<NowPlaying | null> {
  const at = now();

  if (cache && cache.expiresAt > at) {
    await drainInto(cache, onFreshPlays);
    return cache.value;
  }

  let value: NowPlaying | null = null;
  let fresh: readonly LastfmPlay[] = [];

  try {
    const plays = await fetchRecent();
    fresh = plays;
    const first = plays[0];
    if (first) {
      value = {
        track: first.track,
        artist: first.artist,
        album: first.album,
        artworkUrl: first.imageUrl,
        live: first.nowPlaying,
        playedAt: first.playedAt?.toISOString() ?? null,
        source: "lastfm",
      };
    }
  } catch {
  }

  if (!value) {
    try {
      value = await readLatestStored();
    } catch {
      value = null;
    }
  }

  cache = { value, plays: fresh, ingested: false, expiresAt: at + ttlMs };

  await drainInto(cache, onFreshPlays);

  return value;
}

async function drainInto(
  entry: CacheEntry,
  onFreshPlays: NowDeps["onFreshPlays"],
): Promise<void> {
  if (!onFreshPlays) return;
  if (entry.ingested || entry.plays.length === 0) return;

  try {
    await onFreshPlays(entry.plays);
    entry.ingested = true;
  } catch {
  }
}
