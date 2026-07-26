// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LastfmPlay } from "../lastfm/client";
import { clearNowPlayingCache, readNowPlaying, type NowPlaying } from "./now";

const NOW = Date.UTC(2026, 6, 25, 12, 0, 0);

function play(overrides: Partial<LastfmPlay> = {}): LastfmPlay {
  return {
    artist: "Radiohead",
    track: "Weird Fishes",
    album: "In Rainbows",
    imageUrl: "https://img/xl.png",
    playedAt: new Date(NOW - 4 * 60_000),
    nowPlaying: false,
    ...overrides,
  };
}

const STORED: NowPlaying = {
  track: "Stored Track",
  artist: "Stored Artist",
  album: null,
  artworkUrl: null,
  live: false,
  playedAt: new Date(NOW - 3 * 3_600_000).toISOString(),
  source: "local",
};

beforeEach(() => {
  clearNowPlayingCache();
});

describe("live reads", () => {
  it("renders a live indicator when last.fm reports a track in progress", async () => {
    const value = await readNowPlaying({
      fetchRecent: async () => [play({ nowPlaying: true, playedAt: null })],
      readLatestStored: async () => STORED,
      now: () => NOW,
    });

    expect(value).toMatchObject({
      track: "Weird Fishes",
      live: true,
      source: "lastfm",
    });
  });

  it("renders the most recent play without a live indicator when nothing is playing (AE5)", async () => {
    const value = await readNowPlaying({
      fetchRecent: async () => [play()],
      readLatestStored: async () => STORED,
      now: () => NOW,
    });

    expect(value?.live).toBe(false);
    expect(value?.track).toBe("Weird Fishes");
    expect(value?.playedAt).toBe(new Date(NOW - 4 * 60_000).toISOString());
  });

  it("prefers the live read over local storage when both are available", async () => {
    const value = await readNowPlaying({
      fetchRecent: async () => [play()],
      readLatestStored: async () => STORED,
      now: () => NOW,
    });

    expect(value?.source).toBe("lastfm");
  });
});

describe("falling back to local storage (AE8)", () => {
  it("falls back to the newest stored scrobble when last.fm fails", async () => {
    const value = await readNowPlaying({
      fetchRecent: async () => {
        throw new Error("last.fm responded 503");
      },
      readLatestStored: async () => STORED,
      now: () => NOW,
    });

    expect(value).toMatchObject({ track: "Stored Track", source: "local", live: false });
  });

  it("falls back on a timeout rather than blocking the render", async () => {
    const value = await readNowPlaying({
      fetchRecent: async () => {
        throw new DOMException("The operation was aborted.", "TimeoutError");
      },
      readLatestStored: async () => STORED,
      now: () => NOW,
    });

    expect(value?.source).toBe("local");
  });

  it("falls back when last.fm answers with no plays at all", async () => {
    const value = await readNowPlaying({
      fetchRecent: async () => [],
      readLatestStored: async () => STORED,
      now: () => NOW,
    });

    expect(value?.source).toBe("local");
  });

  it("returns null when neither source has anything, rather than throwing", async () => {
    const value = await readNowPlaying({
      fetchRecent: async () => {
        throw new Error("down");
      },
      readLatestStored: async () => null,
      now: () => NOW,
    });

    expect(value).toBeNull();
  });

  it("survives the local read failing too", async () => {
    const value = await readNowPlaying({
      fetchRecent: async () => {
        throw new Error("down");
      },
      readLatestStored: async () => {
        throw new Error("database unreachable");
      },
      now: () => NOW,
    });

    expect(value).toBeNull();
  });
});

describe("the short server cache", () => {
  it("issues one upstream call for repeated requests inside the window", async () => {
    const fetchRecent = vi.fn(async () => [play()]);

    await readNowPlaying({ fetchRecent, now: () => NOW, ttlMs: 20_000 });
    await readNowPlaying({ fetchRecent, now: () => NOW + 5_000, ttlMs: 20_000 });
    await readNowPlaying({ fetchRecent, now: () => NOW + 19_000, ttlMs: 20_000 });

    expect(fetchRecent).toHaveBeenCalledTimes(1);
  });

  it("reads upstream again once the window has passed", async () => {
    const fetchRecent = vi.fn(async () => [play()]);

    await readNowPlaying({ fetchRecent, now: () => NOW, ttlMs: 20_000 });
    await readNowPlaying({ fetchRecent, now: () => NOW + 21_000, ttlMs: 20_000 });

    expect(fetchRecent).toHaveBeenCalledTimes(2);
  });

  it("caches a null result too, so an outage does not become a retry storm", async () => {
    const fetchRecent = vi.fn(async () => {
      throw new Error("down");
    });
    const readLatestStored = vi.fn(async () => null);

    await readNowPlaying({ fetchRecent, readLatestStored, now: () => NOW });
    await readNowPlaying({ fetchRecent, readLatestStored, now: () => NOW + 1_000 });

    expect(fetchRecent).toHaveBeenCalledTimes(1);
    expect(readLatestStored).toHaveBeenCalledTimes(1);
  });
});

describe("keeping the stored history current", () => {
  const play = (track: string, minutesAgo: number | null): LastfmPlay => ({
    track,
    artist: "Ado",
    album: null,
    imageUrl: null,
    nowPlaying: minutesAgo === null,
    playedAt: minutesAgo === null ? null : new Date(Date.now() - minutesAgo * 60_000),
  });

  it("hands the fetched plays to the caller so they can be persisted", async () => {
    clearNowPlayingCache();
    const onFreshPlays = vi.fn();
    const plays = [play("Now", null), play("Earlier", 5)];

    await readNowPlaying({
      fetchRecent: async () => plays,
      readLatestStored: async () => null,
      onFreshPlays,
    });

    expect(onFreshPlays).toHaveBeenCalledWith(plays);
  });

  it("does not re-hand them while the cache is warm", async () => {
    clearNowPlayingCache();
    const onFreshPlays = vi.fn();
    const deps = {
      fetchRecent: async () => [play("Now", null)],
      readLatestStored: async () => null,
      onFreshPlays,
    };

    await readNowPlaying(deps);
    await readNowPlaying(deps);
    await readNowPlaying(deps);

    // Bounded by the cache, so a room full of visitors ingests once.
    expect(onFreshPlays).toHaveBeenCalledTimes(1);
  });

  it("still reports the pulse when persisting throws", async () => {
    clearNowPlayingCache();

    const value = await readNowPlaying({
      fetchRecent: async () => [play("Elf", null)],
      readLatestStored: async () => null,
      onFreshPlays: () => {
        throw new Error("database unreachable");
      },
    });

    // A store that could not be brought up to date is stale, not broken.
    expect(value?.track).toBe("Elf");
    expect(value?.live).toBe(true);
  });

  it("hands nothing over when last.fm returned nothing", async () => {
    clearNowPlayingCache();
    const onFreshPlays = vi.fn();

    await readNowPlaying({
      fetchRecent: async () => [],
      readLatestStored: async () => null,
      onFreshPlays,
    });

    expect(onFreshPlays).not.toHaveBeenCalled();
  });

  it("hands nothing over when the last.fm read failed", async () => {
    clearNowPlayingCache();
    const onFreshPlays = vi.fn();

    await readNowPlaying({
      fetchRecent: async () => {
        throw new Error("last.fm down");
      },
      readLatestStored: async () => null,
      onFreshPlays,
    });

    expect(onFreshPlays).not.toHaveBeenCalled();
  });
});
