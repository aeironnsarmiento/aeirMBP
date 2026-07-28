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

/**
 * The cached read, and the plays that read learned about.
 *
 * The plays are held because throwing them away is what broke ingestion. The
 * server render calls this without a writer, fills the cache, and discards a
 * page of finished scrobbles; the API route then hits the warm cache and has
 * nothing to write. Keeping them means the first caller that *does* attach a
 * writer can drain them, at no extra cost upstream — the fetch already
 * happened.
 *
 * `ingested` flips only on a successful drain, so a failed write leaves the
 * plays pending for the next caller rather than silently consuming them.
 */
type CacheEntry = {
  value: NowPlaying | null;
  plays: readonly LastfmPlay[];
  ingested: boolean;
  expiresAt: number;
};
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

  // A cache hit answers the read, but it does not answer whether storage is
  // up to date — those were the same question, and that is the bug. The value
  // is served from cache either way; the plays behind it are drained by the
  // first caller that brought a writer.
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

  cache = { value, plays: fresh, ingested: false, expiresAt: at + ttlMs };

  await drainInto(cache, onFreshPlays);

  return value;
}

/**
 * Hands a cache entry's plays to the writer, once.
 *
 * Failure is swallowed on purpose — the pulse is this function's contract, and
 * a store that could not be brought up to date is stale rather than broken, so
 * it must not blank the chrome. What it must not do is *hide*: the entry stays
 * un-ingested so the next caller retries, and the caller's own `onFreshPlays`
 * is where the failure gets recorded somewhere the owner can see it.
 */
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
    // Left pending deliberately. See above.
  }
}
