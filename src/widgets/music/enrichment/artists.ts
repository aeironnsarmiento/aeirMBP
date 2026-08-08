import { createDrizzleStore, type MusicStore } from "../server/store";
import { lookupArtistPicture } from "./deezer";

export const ARTIST_BATCH_SIZE = 40;

const MIN_INTERVAL_MS = 200;

export type ArtistSweepResult = {
  processed: number;
  enriched: number;
  missed: number;
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
  budgetMs?: number;
  startedAt?: number;
  now?: () => number;
};

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
