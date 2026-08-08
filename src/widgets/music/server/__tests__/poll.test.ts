// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { LastfmPlay, RecentTracksPage } from "../../lastfm/client";
import { requireCronSecret } from "@/lib/auth/guard";
import { ingestPlays } from "../ingest";
import { runPoll } from "../poll";
import { createMemoryStore, type MemoryStore } from "../store.memory";

const NOW = new Date("2026-07-25T05:00:00.000Z");

function play(minutesAgo: number, track = `Track ${minutesAgo}`): LastfmPlay {
  return {
    artist: "Radiohead",
    track,
    album: "In Rainbows",
    imageUrl: null,
    playedAt: new Date(NOW.getTime() - minutesAgo * 60_000),
    nowPlaying: false,
  };
}

/**
 * A fake last.fm that honours the `from` bound and paginates, so a gap
 * spanning more than one page is exercised end to end.
 */
function fakeLastfm(history: LastfmPlay[], pageSize = 2) {
  const queries: Array<{ page: number; from?: number }> = [];

  const fetchPage = vi.fn(
    async ({
      page,
      from,
    }: {
      page: number;
      from?: number;
    }): Promise<RecentTracksPage> => {
      queries.push({ page, from });
      const window = history
        .filter(
          (entry) =>
            from === undefined ||
            (entry.playedAt !== null &&
              Math.floor(entry.playedAt.getTime() / 1000) >= from),
        )
        .sort((a, b) => b.playedAt!.getTime() - a.playedAt!.getTime());

      const totalPages = Math.max(1, Math.ceil(window.length / pageSize));
      return {
        plays: window.slice((page - 1) * pageSize, page * pageSize),
        page,
        totalPages,
        total: window.length,
      };
    },
  );

  return { fetchPage, queries };
}

function deps(store: MemoryStore, fetchPage: ReturnType<typeof fakeLastfm>["fetchPage"]) {
  return { store, fetchPage, sleep: vi.fn(async () => {}), now: () => NOW };
}

describe("recovering a gap", () => {
  it("fetches every scrobble in a multi-day gap, not only the most recent page", async () => {
    const store = createMemoryStore();
    // One old play establishes the lower bound, then seven land in the gap.
    const seed = play(6000, "Seed");
    await ingestPlays(store, [seed]);

    const gap = [1, 2, 3, 4, 5, 6, 7].map((n) => play(n * 60, `Gap ${n}`));
    const { fetchPage, queries } = fakeLastfm([seed, ...gap], 2);

    const result = await runPoll({ ...deps(store, fetchPage), maxPages: 10 });

    expect(result.inserted).toBe(7);
    expect(queries.length).toBeGreaterThan(1);
    expect(await store.countScrobbles()).toBe(8);
  });

  it("uses the newest stored timestamp as an inclusive lower bound", async () => {
    const store = createMemoryStore();
    const seed = play(120, "Seed");
    await ingestPlays(store, [seed]);
    const { fetchPage, queries } = fakeLastfm([seed, play(10, "New")]);

    await runPoll(deps(store, fetchPage));

    expect(queries[0].from).toBe(Math.floor(seed.playedAt!.getTime() / 1000));
  });

  it("re-fetching the boundary scrobble does not duplicate it", async () => {
    const store = createMemoryStore();
    const seed = play(120, "Seed");
    await ingestPlays(store, [seed]);
    const { fetchPage } = fakeLastfm([seed, play(10, "New")]);

    const result = await runPoll(deps(store, fetchPage));

    expect(result.inserted).toBe(1);
    expect(await store.countScrobbles()).toBe(2);
  });

  it("stops at the page ceiling rather than running past the invocation timeout", async () => {
    const store = createMemoryStore();
    const seed = play(6000, "Seed");
    await ingestPlays(store, [seed]);
    const gap = Array.from({ length: 40 }, (_, n) => play(n + 1, `Gap ${n}`));
    const { fetchPage } = fakeLastfm([seed, ...gap], 2);

    const result = await runPoll({ ...deps(store, fetchPage), maxPages: 3 });

    expect(result.pagesFetched).toBe(3);
  });
});

describe("a quiet run", () => {
  it("inserts nothing and does not error when there are no new scrobbles", async () => {
    const store = createMemoryStore();
    const seed = play(120, "Seed");
    await ingestPlays(store, [seed]);
    const { fetchPage } = fakeLastfm([seed]);

    const result = await runPoll(deps(store, fetchPage));

    expect(result.inserted).toBe(0);
    expect(await store.countScrobbles()).toBe(1);
  });

  it("still records a heartbeat, so the database sees a write on every run", async () => {
    const store = createMemoryStore();
    const seed = play(120, "Seed");
    await ingestPlays(store, [seed]);
    const { fetchPage } = fakeLastfm([seed]);

    await runPoll(deps(store, fetchPage));

    expect(await store.readJob("poll")).toMatchObject({
      status: "ok",
      lastRunAt: NOW,
    });
  });

  it("records a heartbeat even when last.fm fails", async () => {
    const store = createMemoryStore();
    const fetchPage = vi.fn(async () => {
      throw new Error("last.fm is down");
    });

    await expect(runPoll(deps(store, fetchPage))).rejects.toThrow("last.fm is down");

    expect(await store.readJob("poll")).toMatchObject({
      status: "error",
      lastRunAt: NOW,
      lastError: "last.fm is down",
    });
  });
});

describe("an empty store", () => {
  it("does not assume a prior timestamp exists", async () => {
    const store = createMemoryStore();
    const { fetchPage, queries } = fakeLastfm([play(10), play(20), play(30)]);

    const result = await runPoll(deps(store, fetchPage));

    expect(queries[0].from).toBeUndefined();
    expect(result.bootstrap).toBe(true);
    expect(result.from).toBeNull();
  });

  it("takes only the most recent page and leaves the history to backfill", async () => {
    const store = createMemoryStore();
    const { fetchPage } = fakeLastfm(
      Array.from({ length: 20 }, (_, n) => play(n + 1)),
      2,
    );

    const result = await runPoll(deps(store, fetchPage));

    expect(result.pagesFetched).toBe(1);
    expect(await store.countScrobbles()).toBe(2);
  });
});

describe("rate ceiling", () => {
  it("waits between paged requests", async () => {
    const store = createMemoryStore();
    const seed = play(6000, "Seed");
    await ingestPlays(store, [seed]);
    const gap = [1, 2, 3, 4].map((n) => play(n * 60, `Gap ${n}`));
    const { fetchPage } = fakeLastfm([seed, ...gap], 2);
    const sleep = vi.fn(async () => {});

    await runPoll({
      store,
      fetchPage,
      sleep,
      now: () => NOW,
      requestIntervalMs: 250,
    });

    expect(sleep).toHaveBeenCalledWith(250);
  });
});

describe("cron route authorization", () => {
  const secret = "cron-shared-secret-value";

  function request(authorization?: string) {
    return new Request("https://example.test/api/cron/poll", {
      headers: authorization ? { authorization } : {},
    });
  }

  it("rejects a request with no authorization header", () => {
    process.env.CRON_SECRET = secret;

    expect(requireCronSecret(request())?.status).toBe(401);
  });

  it("rejects a request presenting the wrong secret", () => {
    process.env.CRON_SECRET = secret;

    expect(requireCronSecret(request("Bearer nope"))?.status).toBe(401);
    expect(requireCronSecret(request(`Bearer ${secret}x`))?.status).toBe(401);
    expect(requireCronSecret(request(secret))?.status).toBe(401);
  });

  it("admits the scheduler presenting the configured secret", () => {
    process.env.CRON_SECRET = secret;

    expect(requireCronSecret(request(`Bearer ${secret}`))).toBeNull();
  });

  it("fails closed when no cron secret is configured", () => {
    delete process.env.CRON_SECRET;

    expect(requireCronSecret(request(`Bearer ${secret}`))?.status).toBe(500);
  });
});
