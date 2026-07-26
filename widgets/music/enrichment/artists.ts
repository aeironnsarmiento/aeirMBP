import { createDrizzleStore, type MusicStore } from "../server/store";
import { lookupArtistPicture } from "./deezer";

/**
 * Resolves a portrait for each unique artist.
 *
 * Separate from the track sweep rather than folded into it: a track needs two
 * fields from a chain of two sources, an artist needs one field from one. The
 * shared parts are the parts that matter — keyed on the normalized identity,
 * looked up once, and never refreshed, so the API cost stays bounded.
 *
 * Chunked and resumable for the same reason the track sweep is: a few hundred
 * artists at Deezer's rate floor outlasts a serverless invocation, and the
 * store's own filter is the cursor.
 */

export const ARTIST_BATCH_SIZE = 40;

/** Deezer publishes 50 requests / 5 seconds. This stays far under it. */
const MIN_INTERVAL_MS = 200;

export type ArtistSweepResult = {
  processed: number;
  enriched: number;
  /** Artists Deezer had no entry for. Marked attempted so they are not retried. */
  missed: number;
  /** Artists left pending because the lookup failed transiently. */
  deferred: number;
  remaining: number;
  done: boolean;
};

export type ArtistSweepDeps = {
  store?: MusicStore;
  lookup?: (artistName: string) => Promise<string | null>;
  batchSize?: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runArtistSweep({
  store = createDrizzleStore(),
  lookup = (name) => lookupArtistPicture(name),
  batchSize = ARTIST_BATCH_SIZE,
  sleep = defaultSleep,
}: ArtistSweepDeps = {}): Promise<ArtistSweepResult> {
  const pending = await store.pendingArtists(batchSize);

  let enriched = 0;
  let missed = 0;
  let deferred = 0;
  let first = true;

  for (const artist of pending) {
    if (!first) await sleep(MIN_INTERVAL_MS);
    first = false;

    let picture: string | null;
    try {
      picture = await lookup(artist.artistName);
    } catch {
      // Leaving the artist pending is the point: marking it attempted after a
      // transient outage would permanently strand it on the initials tile with
      // nothing to indicate why.
      deferred += 1;
      continue;
    }

    if (picture) {
      await store.recordArtistPicture(artist.artistKey, {
        artistName: artist.artistName,
        pictureUrl: picture,
        source: "deezer",
      });
      enriched += 1;
    } else {
      await store.recordArtistMiss(artist.artistKey);
      missed += 1;
    }
  }

  const remaining = await store.countPendingArtists();

  return {
    processed: pending.length,
    enriched,
    missed,
    deferred,
    remaining,
    done: pending.length === 0 || remaining === 0,
  };
}
