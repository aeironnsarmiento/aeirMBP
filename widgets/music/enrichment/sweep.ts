import { createDrizzleStore, type MusicStore, type PendingTrack } from "../server/store";
import { createDeezerProvider } from "./deezer";
import { createMusicBrainzProvider } from "./musicbrainz";
import { isUsable, type EnrichmentProvider } from "./provider";

/**
 * Resolves duration and artwork for unique tracks (R23).
 *
 * Keyed on the normalized track identity and cached permanently (KTD7):
 * ~7,300 scrobbles reduce to roughly 1,500 unique tracks, each looked up once
 * and never refreshed. That trades metadata freshness for a bounded, one-time
 * API cost.
 *
 * Chunked and resumable (KTD8): 1,500 tracks at MusicBrainz's 1 req/sec floor
 * is about 25 minutes, well past any serverless invocation timeout. Each run
 * takes a bounded batch and the store's own filter is the cursor.
 */

export const BATCH_SIZE = 25;

export type SweepResult = {
  processed: number;
  enriched: number;
  /** Tracks neither source could match. Marked attempted so they are not retried. */
  missed: number;
  /** Tracks left pending because a provider failed transiently. */
  deferred: number;
  /** Tracks still awaiting a first attempt after this run. */
  remaining: number;
  done: boolean;
};

export type SweepDeps = {
  store?: MusicStore;
  providers?: EnrichmentProvider[];
  batchSize?: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Deezer first, MusicBrainz on a miss. */
export function defaultProviders(): EnrichmentProvider[] {
  return [createDeezerProvider(), createMusicBrainzProvider()];
}

export async function runEnrichmentSweep({
  store = createDrizzleStore(),
  providers = defaultProviders(),
  batchSize = BATCH_SIZE,
  sleep = defaultSleep,
}: SweepDeps = {}): Promise<SweepResult> {
  const pending = await store.pendingEnrichment(batchSize);

  let enriched = 0;
  let missed = 0;
  let deferred = 0;

  // One timestamp per provider so each one's own rate ceiling is respected
  // independently — Deezer's 200ms must not be slowed to MusicBrainz's second.
  const lastCallAt = new Map<string, number>();

  for (const track of pending) {
    const outcome = await enrichOne(track, providers, sleep, lastCallAt);

    if (outcome.failed && !isUsable(outcome.result)) {
      // A provider threw. Leaving the track pending is the whole point: marking
      // it attempted after a transient outage would permanently exclude it from
      // the minutes total with no way to notice.
      deferred += 1;
      continue;
    }

    if (isUsable(outcome.result)) {
      await store.recordEnrichment(track.trackKey, {
        durationMs: outcome.result.durationMs,
        artworkUrl: outcome.result.artworkUrl,
        source: outcome.sources.join("+"),
      });
      enriched += 1;
    } else {
      await store.recordEnrichmentMiss(track.trackKey);
      missed += 1;
    }
  }

  const remaining = await store.countPendingEnrichment();

  return {
    processed: pending.length,
    enriched,
    missed,
    deferred,
    remaining,
    done: pending.length === 0 || remaining === 0,
  };
}

type Outcome = {
  result: { durationMs: number | null; artworkUrl: string | null };
  sources: string[];
  failed: boolean;
};

/**
 * Walks the provider chain, stopping as soon as both fields are resolved.
 *
 * A provider that supplies only one field does not end the chain — Deezer
 * regularly returns a duration with no cover, and letting MusicBrainz fill the
 * gap is strictly better than storing a half-enriched track.
 */
async function enrichOne(
  track: PendingTrack,
  providers: readonly EnrichmentProvider[],
  sleep: (ms: number) => Promise<void>,
  lastCallAt: Map<string, number>,
): Promise<Outcome> {
  const result: Outcome["result"] = { durationMs: null, artworkUrl: null };
  const sources: string[] = [];
  let failed = false;

  for (const provider of providers) {
    if (result.durationMs !== null && result.artworkUrl !== null) break;

    if (lastCallAt.has(provider.name)) await sleep(provider.minIntervalMs);
    lastCallAt.set(provider.name, 1);

    let found: Awaited<ReturnType<EnrichmentProvider["lookup"]>>;
    try {
      found = await provider.lookup(track);
    } catch {
      failed = true;
      continue;
    }

    if (!found) continue;

    let contributed = false;
    if (result.durationMs === null && found.durationMs !== null) {
      result.durationMs = found.durationMs;
      contributed = true;
    }
    if (result.artworkUrl === null && found.artworkUrl !== null) {
      result.artworkUrl = found.artworkUrl;
      contributed = true;
    }
    if (contributed) sources.push(provider.name);
  }

  return { result, sources, failed };
}
