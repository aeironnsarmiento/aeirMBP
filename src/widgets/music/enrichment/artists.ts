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

export type DrainDeps = ArtistSweepDeps & {
  /** Milliseconds the drain may spend, measured from `startedAt`. */
  budgetMs?: number;
  /** When the caller's clock started — the request, not this call. */
  startedAt?: number;
  now?: () => number;
};

/**
 * Runs batches until the work list empties or the budget runs out.
 *
 * One batch per owner click meant the owner had to know how many clicks "done"
 * was, and stopping early left artists on an album sleeve where a portrait
 * belongs with nothing on screen to say why. The sweep was already resumable,
 * so this is a loop around it rather than a change to it: a run cut short by
 * the budget resumes exactly where it stopped.
 *
 * `startedAt` is the caller's clock rather than this function's, because the
 * track sweep runs first in the same serverless invocation and spends the same
 * ceiling. Measuring from here would let the two together exceed it.
 *
 * Three ways out, and the third is the one that matters: a batch where every
 * artist deferred means the provider is failing, and those artists are
 * deliberately left un-attempted so a later run retries them. Looping on that
 * would spin against a dead provider for the whole budget, accomplishing
 * nothing and recording nothing.
 */
export async function drainArtistSweep({
  budgetMs = Infinity,
  startedAt,
  now = Date.now,
  ...sweepDeps
}: DrainDeps = {}): Promise<ArtistSweepResult> {
  const began = startedAt ?? now();

  const total: ArtistSweepResult = {
    processed: 0,
    enriched: 0,
    missed: 0,
    deferred: 0,
    remaining: 0,
    done: false,
  };

  for (;;) {
    const batch = await runArtistSweep(sweepDeps);

    total.processed += batch.processed;
    total.enriched += batch.enriched;
    total.missed += batch.missed;
    total.deferred += batch.deferred;
    total.remaining = batch.remaining;
    total.done = batch.done;

    if (batch.done || batch.processed === 0) break;
    if (batch.deferred === batch.processed) break;
    if (now() - began >= budgetMs) break;
  }

  return total;
}
