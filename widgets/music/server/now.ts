import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { musicScrobble, musicTrack } from "@/lib/db/schema";
import { getRecentTracks, type LastfmPlay } from "../lastfm/client";

/**
 * The now-playing pulse (R27, R29).
 *
 * This is the one music surface that reads last.fm live. A daily cron cannot
 * make "what is playing right now" fresh, so the freshness-critical read goes
 * upstream at request time behind a short server-side cache, and falls back to
 * the newest stored scrobble when that read fails or times out (AE8).
 *
 * The live affordance is shown only when last.fm actually reports a
 * currently-playing track. Otherwise the chrome shows the most recent play,
 * which is a different statement and must not look the same (AE5).
 */

export type NowPlaying = {
  track: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
  /** True only when last.fm reports a track in progress. */
  live: boolean;
  playedAt: string | null;
  source: "lastfm" | "local";
};

/** Short enough to feel live, long enough that a refresh storm hits once. */
export const CACHE_TTL_MS = 20_000;

/** last.fm must not be able to hold the shell's render open. */
export const LASTFM_TIMEOUT_MS = 2_500;

/**
 * How many recent plays this read pulls back.
 *
 * More than the pulse needs, because the same response is what keeps the
 * stored history current. A Hobby-plan cron is capped at once per day, so a
 * schedule can never make "recently played" recent — but this read already
 * runs every time someone is looking at the site, which is exactly when the
 * history needs to be up to date. Enough to cover a long listening session
 * between two visits without paging.
 */
export const CATCH_UP_LIMIT = 50;

type CacheEntry = { value: NowPlaying | null; expiresAt: number };
let cache: CacheEntry | null = null;

/** Test seam. Not called by request paths. */
export function clearNowPlayingCache(): void {
  cache = null;
}

export type NowDeps = {
  fetchRecent?: () => Promise<LastfmPlay[]>;
  readLatestStored?: () => Promise<NowPlaying | null>;
  /**
   * Handed the plays this read fetched, on a cache miss only.
   *
   * The caller decides what to do with them — the API route persists them so
   * the stored history keeps up; the server render does not, because a write
   * has no business holding a page open.
   */
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
  if (cache && cache.expiresAt > at) return cache.value;

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
    // Falls through to local storage below. A last.fm outage degrades the
    // pulse to "most recently played" rather than emptying the chrome.
  }

  if (!value) {
    try {
      value = await readLatestStored();
    } catch {
      value = null;
    }
  }

  cache = { value, expiresAt: at + ttlMs };

  if (onFreshPlays && fresh.length > 0) {
    try {
      await onFreshPlays(fresh);
    } catch {
      // The pulse is the contract here. A store that could not be brought up
      // to date is stale, not broken, and must not blank the chrome.
    }
  }

  return value;
}
