import { createDrizzleStore, type MusicStore, type PendingTrack } from "../server/store";
import { createDeezerProvider } from "./deezer";
import { createMusicBrainzProvider } from "./musicbrainz";
import { isUsable, type EnrichmentProvider } from "./provider";

export const BATCH_SIZE = 25;

export type SweepResult = {
  processed: number;
  enriched: number;
  missed: number;
  deferred: number;
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

  const lastCallAt = new Map<string, number>();

  for (const track of pending) {
    const outcome = await enrichOne(track, providers, sleep, lastCallAt);

    if (outcome.failed && !isUsable(outcome.result)) {
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
