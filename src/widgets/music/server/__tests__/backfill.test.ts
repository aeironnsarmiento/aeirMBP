// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { LastfmPlay, RecentTracksPage } from "../../lastfm/client";
import { runBackfill } from "../backfill";
import { createMemoryStore, type MemoryStore } from "../store.memory";

const START = new Date("2026-07-25T12:00:00.000Z");

function play(index: number, pageNumber: number): LastfmPlay {
  return {
    artist: "Radiohead",
    track: `Track ${pageNumber}-${index}`,
    album: "In Rainbows",
    imageUrl: null,
    playedAt: new Date(START.getTime() - (pageNumber * 100 + index) * 60_000),
    nowPlaying: false,
  };
}

/** A fake history of `totalPages` pages, two plays each. */
function fakeHistory(totalPages: number) {
  const calls: Array<{ page: number; to: number }> = [];

  const fetchPage = vi.fn(
    async ({ page, to }: { page: number; to: number }): Promise<RecentTracksPage> => {
      calls.push({ page, to });
      return {
        plays: [play(0, page), play(1, page)],
        page,
        totalPages,
        total: totalPages * 2,
      };
    },
  );

  return { fetchPage, calls };
}

function deps(store: MemoryStore, fetchPage: ReturnType<typeof fakeHistory>["fetchPage"]) {
  return {
    store,
    fetchPage,
    sleep: vi.fn(async () => {}),
    now: () => START,
  };
}

describe("resuming", () => {
  it("resumes from the stored cursor rather than restarting", async () => {
    const store = createMemoryStore();
    const { fetchPage, calls } = fakeHistory(6);

    await runBackfill({ ...deps(store, fetchPage), pagesPerRun: 2 });
    calls.length = 0;
    await runBackfill({ ...deps(store, fetchPage), pagesPerRun: 2 });

    expect(calls.map((call) => call.page)).toEqual([3, 4]);
  });

  it("pins the upper time bound from the first run so pages do not shift", async () => {
    const store = createMemoryStore();
    const { fetchPage, calls } = fakeHistory(6);

    await runBackfill({ ...deps(store, fetchPage), pagesPerRun: 2 });
    await runBackfill({
      ...deps(store, fetchPage),
      now: () => new Date(START.getTime() + 86_400_000),
      pagesPerRun: 2,
    });

    const bounds = new Set(calls.map((call) => call.to));
    expect(bounds.size).toBe(1);
    expect([...bounds][0]).toBe(Math.floor(START.getTime() / 1000));
  });

  it("advances the cursor only after a page's rows are committed", async () => {
    const store = createMemoryStore();
    let failOnPage2 = true;

    const fetchPage = vi.fn(
      async ({ page }: { page: number }): Promise<RecentTracksPage> => {
        if (page === 2 && failOnPage2) throw new Error("last.fm exploded");
        return {
          plays: [play(0, page), play(1, page)],
          page,
          totalPages: 3,
          total: 6,
        };
      },
    );

    await expect(
      runBackfill({ ...deps(store, fetchPage), pagesPerRun: 5 }),
    ).rejects.toThrow("last.fm exploded");

    const afterFailure = await store.countScrobbles();
    expect(afterFailure).toBe(2);

    failOnPage2 = false;
    const resumed = await runBackfill({ ...deps(store, fetchPage), pagesPerRun: 5 });

    // Page 2 is re-fetched, not skipped: the whole history lands.
    expect(await store.countScrobbles()).toBe(6);
    expect(resumed.done).toBe(true);
  });

  it("records the failure on the job row", async () => {
    const store = createMemoryStore();
    const fetchPage = vi.fn(async () => {
      throw new Error("last.fm exploded");
    });

    await expect(runBackfill(deps(store, fetchPage))).rejects.toThrow();

    expect(await store.readJob("backfill")).toMatchObject({
      status: "error",
      lastError: "last.fm exploded",
    });
  });

  it("starts over when explicitly restarted", async () => {
    const store = createMemoryStore();
    const { fetchPage, calls } = fakeHistory(6);

    await runBackfill({ ...deps(store, fetchPage), pagesPerRun: 2 });
    calls.length = 0;
    await runBackfill({ ...deps(store, fetchPage), pagesPerRun: 2, restart: true });

    expect(calls.map((call) => call.page)).toEqual([1, 2]);
  });
});

describe("completion", () => {
  it("imports every page across successive runs and reports done", async () => {
    const store = createMemoryStore();
    const { fetchPage } = fakeHistory(5);

    let progress = await runBackfill({ ...deps(store, fetchPage), pagesPerRun: 2 });
    while (!progress.done) {
      progress = await runBackfill({ ...deps(store, fetchPage), pagesPerRun: 2 });
    }

    expect(progress.done).toBe(true);
    expect(progress.insertedTotal).toBe(10);
    expect(await store.countScrobbles()).toBe(10);
  });

  it("re-triggering a completed import inserts nothing and issues no requests", async () => {
    const store = createMemoryStore();
    const { fetchPage } = fakeHistory(2);

    let progress = await runBackfill({ ...deps(store, fetchPage), pagesPerRun: 5 });
    expect(progress.done).toBe(true);
    const callsAfterImport = fetchPage.mock.calls.length;

    progress = await runBackfill({ ...deps(store, fetchPage), pagesPerRun: 5 });

    expect(progress.insertedThisRun).toBe(0);
    expect(progress.pagesFetched).toBe(0);
    expect(fetchPage.mock.calls.length).toBe(callsAfterImport);
    expect(await store.countScrobbles()).toBe(4);
  });

  it("does not double-count when a page is re-fetched after an interruption", async () => {
    const store = createMemoryStore();
    const { fetchPage } = fakeHistory(4);

    await runBackfill({ ...deps(store, fetchPage), pagesPerRun: 2 });
    // Rewind the cursor as an interrupted run would leave it.
    const job = await store.readJob("backfill");
    await store.writeJob("backfill", {
      cursor: { ...(job?.cursor as Record<string, unknown>), page: 2 },
    });

    let progress = await runBackfill({ ...deps(store, fetchPage), pagesPerRun: 5 });
    while (!progress.done) {
      progress = await runBackfill({ ...deps(store, fetchPage), pagesPerRun: 5 });
    }

    expect(await store.countScrobbles()).toBe(8);
  });
});

describe("rate ceiling", () => {
  it("waits between requests rather than firing a batch back to back", async () => {
    const store = createMemoryStore();
    const { fetchPage } = fakeHistory(6);
    const sleep = vi.fn(async () => {});

    await runBackfill({
      store,
      fetchPage,
      sleep,
      now: () => START,
      pagesPerRun: 4,
      requestIntervalMs: 250,
    });

    // Four requests, three gaps.
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(250);
  });
});

describe("track seeding", () => {
  it("registers each imported track once for the enrichment sweep", async () => {
    const store = createMemoryStore();
    const { fetchPage } = fakeHistory(3);

    let progress = await runBackfill({ ...deps(store, fetchPage), pagesPerRun: 5 });
    while (!progress.done) {
      progress = await runBackfill({ ...deps(store, fetchPage), pagesPerRun: 5 });
    }

    expect(store.tracks.size).toBe(6);
    expect(await store.countPendingEnrichment()).toBe(6);
  });
});
