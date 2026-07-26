import {
  MAX_PAGE_SIZE,
  getRecentTracks,
  type RecentTracksPage,
} from "../lastfm/client";
import { ingestPlays } from "./ingest";
import { createDrizzleStore, type MusicStore } from "./store";

/**
 * Daily incremental poll (R21, R22).
 *
 * Vercel's Hobby plan caps cron at once per day, so this is a freshness knob
 * rather than a correctness one (KTD5): the poll resumes from the newest
 * stored timestamp and last.fm retains full history, so a missed day is
 * recovered on the next run rather than lost. Freshness-critical surfaces read
 * last.fm live instead of waiting for this.
 *
 * It is also the Supabase keepalive. A free project pauses after 7 consecutive
 * days with no database request, and this job's heartbeat write resets that
 * timer — which is why it writes on every run, including runs that ingest
 * nothing.
 */

/** Bounded so one invocation cannot run past a serverless timeout. */
export const MAX_PAGES_PER_POLL = 10;

export const REQUEST_INTERVAL_MS = 250;

export type PollResult = {
  inserted: number;
  pagesFetched: number;
  /** The lower bound used, in epoch seconds. Null on a first-ever poll. */
  from: number | null;
  /** True when the store was empty, so only the most recent page was taken. */
  bootstrap: boolean;
  /** Newest stored play after this run. */
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

  // An empty store means backfill has not run. Take only the most recent page
  // rather than assuming a prior timestamp — the full history is backfill's job.
  const bootstrap = newest === null;

  // Inclusive lower bound. Re-fetching the newest stored scrobble is free
  // because ingestion is idempotent; skipping one because two plays share a
  // second is not recoverable.
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

  // The heartbeat is unconditional, including on failure. Its second job is
  // keeping the Supabase project awake, and a run that errored still counts as
  // database activity (KTD5).
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
