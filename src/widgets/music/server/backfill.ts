import { MAX_PAGE_SIZE, getRecentTracks, type RecentTracksPage } from "../lastfm/client";
import { ingestPlays } from "./ingest";
import { createDrizzleStore, type MusicStore } from "./store";

/**
 * One-time import of the owner's full last.fm history (R20).
 *
 * Two properties matter more than speed:
 *
 * - **Resumable.** ~37 pages at the current history size, and the sweep grows
 *   with the account. A serverless invocation will time out before the import
 *   finishes eventually, so each run processes a bounded batch and advances a
 *   stored cursor (KTD8). Interrupting it loses nothing.
 * - **Pinned window.** The cursor records an upper timestamp bound taken when
 *   the import started, and every page request carries it. Without that, a
 *   scrobble landing mid-import shifts every subsequent page by one and the
 *   run silently skips a play.
 */

export const PAGES_PER_RUN = 5;

/** ~4 requests/second. last.fm does not publish its ceiling; this stays well under it. */
export const REQUEST_INTERVAL_MS = 250;

export type BackfillCursor = {
  /** Upper bound in epoch seconds, fixed when the import started. */
  to: number;
  /** Next page to fetch. Pages run newest-first within the pinned window. */
  page: number;
  totalPages: number | null;
  /** Scrobbles inserted across every run of this import. */
  inserted: number;
  startedAt: string;
};

export type BackfillProgress = {
  done: boolean;
  page: number;
  totalPages: number | null;
  /** Inserted by this run. */
  insertedThisRun: number;
  /** Inserted across the whole import. */
  insertedTotal: number;
  pagesFetched: number;
};

export type BackfillDeps = {
  store?: MusicStore;
  fetchPage?: (query: {
    page: number;
    to: number;
    limit: number;
  }) => Promise<RecentTracksPage>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  pagesPerRun?: number;
  requestIntervalMs?: number;
  /** Discards any stored cursor and imports from the beginning. */
  restart?: boolean;
};

function isCursor(value: unknown): value is BackfillCursor {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BackfillCursor>;
  return (
    typeof candidate.to === "number" &&
    typeof candidate.page === "number" &&
    typeof candidate.inserted === "number"
  );
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runBackfill({
  store = createDrizzleStore(),
  fetchPage = (query) => getRecentTracks(query),
  sleep = defaultSleep,
  now = () => new Date(),
  pagesPerRun = PAGES_PER_RUN,
  requestIntervalMs = REQUEST_INTERVAL_MS,
  restart = false,
}: BackfillDeps = {}): Promise<BackfillProgress> {
  const startedAt = now();
  const existing = restart ? null : (await store.readJob("backfill"))?.cursor;

  let cursor: BackfillCursor = isCursor(existing)
    ? existing
    : {
        to: Math.floor(startedAt.getTime() / 1000),
        page: 1,
        totalPages: null,
        inserted: 0,
        startedAt: startedAt.toISOString(),
      };

  // Already finished, and re-triggering must stay free (no requests, no rows).
  if (cursor.totalPages !== null && cursor.page > cursor.totalPages) {
    return {
      done: true,
      page: cursor.page,
      totalPages: cursor.totalPages,
      insertedThisRun: 0,
      insertedTotal: cursor.inserted,
      pagesFetched: 0,
    };
  }

  await store.writeJob("backfill", {
    status: "running",
    cursor,
    lastRunAt: startedAt,
    lastError: null,
  });

  let insertedThisRun = 0;
  let pagesFetched = 0;

  try {
    for (let batch = 0; batch < pagesPerRun; batch += 1) {
      if (cursor.totalPages !== null && cursor.page > cursor.totalPages) break;

      if (pagesFetched > 0) await sleep(requestIntervalMs);

      const result = await fetchPage({
        page: cursor.page,
        to: cursor.to,
        limit: MAX_PAGE_SIZE,
      });
      pagesFetched += 1;

      const ingested = await ingestPlays(store, result.plays);
      insertedThisRun += ingested.inserted;

      // The cursor advances only after this page's rows are committed, so an
      // interruption between the two re-fetches the page rather than skipping it.
      cursor = {
        ...cursor,
        page: cursor.page + 1,
        totalPages: Number.isFinite(result.totalPages)
          ? result.totalPages
          : cursor.totalPages,
        inserted: cursor.inserted + ingested.inserted,
      };

      await store.writeJob("backfill", { cursor });
    }
  } catch (error) {
    await store.writeJob("backfill", {
      status: "error",
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const done = cursor.totalPages !== null && cursor.page > cursor.totalPages;

  await store.writeJob("backfill", {
    status: done ? "complete" : "paused",
    cursor,
  });

  return {
    done,
    page: cursor.page,
    totalPages: cursor.totalPages,
    insertedThisRun,
    insertedTotal: cursor.inserted,
    pagesFetched,
  };
}

/** Progress for the Settings widget, without running anything. */
export async function readBackfillProgress(
  store: MusicStore = createDrizzleStore(),
) {
  const job = await store.readJob("backfill");
  const cursor = isCursor(job?.cursor) ? job.cursor : null;
  return {
    status: job?.status ?? "idle",
    page: cursor?.page ?? 0,
    totalPages: cursor?.totalPages ?? null,
    insertedTotal: cursor?.inserted ?? 0,
    lastRunAt: job?.lastRunAt ?? null,
    lastError: job?.lastError ?? null,
    storedScrobbles: await store.countScrobbles(),
  };
}
