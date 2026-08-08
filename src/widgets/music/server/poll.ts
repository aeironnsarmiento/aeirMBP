import {
  MAX_PAGE_SIZE,
  getRecentTracks,
  type RecentTracksPage,
} from "../lastfm/client";
import { ingestPlays } from "./ingest";
import { createDrizzleStore, type MusicStore } from "./store";

export const MAX_PAGES_PER_POLL = 10;

export const REQUEST_INTERVAL_MS = 250;

export type PollResult = {
  inserted: number;
  pagesFetched: number;
  from: number | null;
  bootstrap: boolean;
  newestScrobbleAt: Date | null;
};

export type PollDeps = {
  store?: MusicStore;
  fetchPage?: (query: {
    page: number;
    from?: number;
    limit: number;
  }) => Promise<RecentTracksPage>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  maxPages?: number;
  requestIntervalMs?: number;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runPoll({
  store = createDrizzleStore(),
  fetchPage = (query) => getRecentTracks(query),
  sleep = defaultSleep,
  now = () => new Date(),
  maxPages = MAX_PAGES_PER_POLL,
  requestIntervalMs = REQUEST_INTERVAL_MS,
}: PollDeps = {}): Promise<PollResult> {
  const startedAt = now();
  const newest = await store.newestScrobbleAt();

  const bootstrap = newest === null;

  const from = newest ? Math.floor(newest.getTime() / 1000) : undefined;

  let inserted = 0;
  let pagesFetched = 0;
  let lastError: string | null = null;

  try {
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && pagesFetched < (bootstrap ? 1 : maxPages)) {
      if (pagesFetched > 0) await sleep(requestIntervalMs);

      const result = await fetchPage({ page, from, limit: MAX_PAGE_SIZE });
      pagesFetched += 1;

      const ingested = await ingestPlays(store, result.plays);
      inserted += ingested.inserted;

      totalPages = Number.isFinite(result.totalPages) ? result.totalPages : 1;
      page += 1;
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }

  await store.writeJob("poll", {
    status: lastError ? "error" : "ok",
    lastRunAt: startedAt,
    lastError,
    cursor: { from: from ?? null, inserted, pagesFetched },
  });

  if (lastError) throw new Error(lastError);

  return {
    inserted,
    pagesFetched,
    from: from ?? null,
    bootstrap,
    newestScrobbleAt: await store.newestScrobbleAt(),
  };
}
