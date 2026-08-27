// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ingestPlays } from "../../server/ingest";
import type { LastfmPlay } from "../../lastfm/client";
import { createMemoryStore, type MemoryStore } from "../../server/store.memory";
import type { EnrichmentProvider, ProviderResult } from "../provider";
import { drainEnrichmentSweep, runEnrichmentSweep } from "../sweep";

function play(track: string, minutesAgo = 10): LastfmPlay {
  return {
    artist: "Radiohead",
    track,
    album: "In Rainbows",
    imageUrl: null,
    playedAt: new Date(Date.UTC(2026, 6, 20, 10, 0, 0) - minutesAgo * 60_000),
    nowPlaying: false,
  };
}

async function storeWithTracks(...titles: string[]): Promise<MemoryStore> {
  const store = createMemoryStore();
  await ingestPlays(
    store,
    titles.map((title, index) => play(title, index)),
  );
  return store;
}

function provider(
  name: string,
  lookup: (track: { trackName: string }) => Promise<ProviderResult | null>,
  minIntervalMs = 10,
): EnrichmentProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    minIntervalMs,
    calls,
    async lookup(track) {
      calls.push(track.trackName);
      return lookup(track);
    },
  };
}

const HIT: ProviderResult = {
  durationMs: 261_000,
  artworkUrl: "https://cdn.example/cover.jpg",
};

const sleep = () => vi.fn(async () => {});

describe("the fallback chain", () => {
  it("stores duration and artwork from a Deezer hit without calling MusicBrainz", async () => {
    const store = await storeWithTracks("Weird Fishes");
    const deezer = provider("deezer", async () => HIT);
    const musicbrainz = provider("musicbrainz", async () => HIT);

    const result = await runEnrichmentSweep({
      store,
      providers: [deezer, musicbrainz],
      sleep: sleep(),
    });

    expect(result.enriched).toBe(1);
    expect(musicbrainz.calls).toEqual([]);
    const track = [...store.tracks.values()][0];
    expect(track.durationMs).toBe(261_000);
    expect(track.artworkUrl).toBe("https://cdn.example/cover.jpg");
    expect(track.source).toBe("deezer");
  });

  it("falls through to MusicBrainz on a Deezer miss", async () => {
    const store = await storeWithTracks("Weird Fishes");
    const deezer = provider("deezer", async () => null);
    const musicbrainz = provider("musicbrainz", async () => HIT);

    const result = await runEnrichmentSweep({
      store,
      providers: [deezer, musicbrainz],
      sleep: sleep(),
    });

    expect(result.enriched).toBe(1);
    expect(musicbrainz.calls).toEqual(["Weird Fishes"]);
    expect([...store.tracks.values()][0].source).toBe("musicbrainz");
  });

  it("lets MusicBrainz fill in artwork when Deezer returned only a duration", async () => {
    const store = await storeWithTracks("Weird Fishes");
    const deezer = provider("deezer", async () => ({
      durationMs: 261_000,
      artworkUrl: null,
    }));
    const musicbrainz = provider("musicbrainz", async () => ({
      durationMs: 999_000,
      artworkUrl: "https://coverartarchive.example/front-500",
    }));

    await runEnrichmentSweep({
      store,
      providers: [deezer, musicbrainz],
      sleep: sleep(),
    });

    const track = [...store.tracks.values()][0];
    expect(track.durationMs).toBe(261_000);
    expect(track.artworkUrl).toBe("https://coverartarchive.example/front-500");
    expect(track.source).toBe("deezer+musicbrainz");
  });
});

describe("tracks neither source can match (AE4)", () => {
  it("marks the track attempted and leaves its duration unresolved", async () => {
    const store = await storeWithTracks("Obscure Bootleg");

    const result = await runEnrichmentSweep({
      store,
      providers: [
        provider("deezer", async () => null),
        provider("musicbrainz", async () => null),
      ],
      sleep: sleep(),
    });

    expect(result.missed).toBe(1);
    expect(result.enriched).toBe(0);
    const track = [...store.tracks.values()][0];
    expect(track.durationMs).toBeNull();
    expect(track.attemptedAt).not.toBeNull();
    expect(track.enrichedAt).toBeNull();
  });

  it("does not retry a track already marked attempted-and-failed", async () => {
    const store = await storeWithTracks("Obscure Bootleg");
    const providers = [
      provider("deezer", async () => null),
      provider("musicbrainz", async () => null),
    ];

    await runEnrichmentSweep({ store, providers, sleep: sleep() });
    const callsAfterFirst = providers[0].calls.length;

    const second = await runEnrichmentSweep({ store, providers, sleep: sleep() });

    expect(providers[0].calls.length).toBe(callsAfterFirst);
    expect(second.processed).toBe(0);
  });
});

describe("transient provider failure", () => {
  it("leaves the track pending rather than marking it permanently missed", async () => {
    const store = await storeWithTracks("Weird Fishes");
    const failing = provider("deezer", async () => {
      throw new Error("Deezer responded 503");
    });

    const result = await runEnrichmentSweep({
      store,
      providers: [failing],
      sleep: sleep(),
    });

    expect(result.deferred).toBe(1);
    expect(result.missed).toBe(0);
    expect([...store.tracks.values()][0].attemptedAt).toBeNull();
    expect(result.remaining).toBe(1);
  });

  it("still records what a surviving provider found", async () => {
    const store = await storeWithTracks("Weird Fishes");

    const result = await runEnrichmentSweep({
      store,
      providers: [
        provider("deezer", async () => {
          throw new Error("Deezer responded 503");
        }),
        provider("musicbrainz", async () => HIT),
      ],
      sleep: sleep(),
    });

    expect(result.enriched).toBe(1);
    expect([...store.tracks.values()][0].source).toBe("musicbrainz");
  });

  it("recovers the deferred track on a later run", async () => {
    const store = await storeWithTracks("Weird Fishes");
    let down = true;
    const flaky = provider("deezer", async () => {
      if (down) throw new Error("Deezer responded 503");
      return HIT;
    });

    await runEnrichmentSweep({ store, providers: [flaky], sleep: sleep() });
    down = false;
    const second = await runEnrichmentSweep({ store, providers: [flaky], sleep: sleep() });

    expect(second.enriched).toBe(1);
    expect(second.remaining).toBe(0);
  });
});

describe("chunking and resumption", () => {
  it("processes a bounded batch and leaves the rest for the next run", async () => {
    const store = await storeWithTracks("A", "B", "C", "D", "E");
    const providers = [provider("deezer", async () => HIT)];

    const first = await runEnrichmentSweep({
      store,
      providers,
      batchSize: 2,
      sleep: sleep(),
    });

    expect(first.processed).toBe(2);
    expect(first.remaining).toBe(3);
    expect(first.done).toBe(false);
  });

  it("resumes without reprocessing completed tracks", async () => {
    const store = await storeWithTracks("A", "B", "C", "D");
    const deezer = provider("deezer", async () => HIT);

    await runEnrichmentSweep({ store, providers: [deezer], batchSize: 2, sleep: sleep() });
    await runEnrichmentSweep({ store, providers: [deezer], batchSize: 2, sleep: sleep() });

    expect(deezer.calls).toHaveLength(4);
    expect(new Set(deezer.calls).size).toBe(4);
  });

  it("issues no requests once every track is resolved", async () => {
    const store = await storeWithTracks("A", "B");
    const deezer = provider("deezer", async () => HIT);

    let result = await runEnrichmentSweep({ store, providers: [deezer], sleep: sleep() });
    expect(result.done).toBe(true);
    const callsAfterSweep = deezer.calls.length;

    result = await runEnrichmentSweep({ store, providers: [deezer], sleep: sleep() });

    expect(deezer.calls.length).toBe(callsAfterSweep);
    expect(result.processed).toBe(0);
  });

  it("enriches per unique track, not per play", async () => {
    const store = createMemoryStore();
    await ingestPlays(store, [play("Weird Fishes", 1), play("Weird Fishes", 2)]);
    const deezer = provider("deezer", async () => HIT);

    await runEnrichmentSweep({ store, providers: [deezer], sleep: sleep() });

    expect(await store.countScrobbles()).toBe(2);
    expect(deezer.calls).toHaveLength(1);
  });
});

describe("rate ceilings", () => {
  it("waits a provider's own interval between its calls", async () => {
    const store = await storeWithTracks("A", "B", "C");
    const waited = vi.fn(async (_ms: number) => {});
    const deezer = provider("deezer", async () => HIT, 200);

    await runEnrichmentSweep({ store, providers: [deezer], sleep: waited });

    // Three calls, two gaps.
    expect(waited).toHaveBeenCalledTimes(2);
    expect(waited).toHaveBeenCalledWith(200);
  });

  it("does not slow Deezer to the MusicBrainz ceiling", async () => {
    const store = await storeWithTracks("A", "B");
    const waited = vi.fn(async (_ms: number) => {});
    const deezer = provider("deezer", async () => null, 200);
    const musicbrainz = provider("musicbrainz", async () => HIT, 1100);

    await runEnrichmentSweep({
      store,
      providers: [deezer, musicbrainz],
      sleep: waited,
    });

    const intervals = waited.mock.calls.map((call) => call[0]);
    expect(intervals).toContain(200);
    expect(intervals).toContain(1100);
  });
});

describe("draining the whole backlog", () => {
  it("keeps sweeping past one batch until nothing is pending", async () => {
    const store = await storeWithTracks("One", "Two", "Three");
    const deezer = provider("deezer", async () => HIT);

    const result = await drainEnrichmentSweep({
      store,
      providers: [deezer],
      batchSize: 1,
      sleep: sleep(),
    });

    expect(result.processed).toBe(3);
    expect(result.enriched).toBe(3);
    expect(result.remaining).toBe(0);
    expect(result.done).toBe(true);
    expect(deezer.calls.sort()).toEqual(["One", "Three", "Two"]);
  });

  it("stops once the time budget is spent, leaving the rest pending", async () => {
    const store = await storeWithTracks("One", "Two", "Three");
    let clock = 0;

    const result = await drainEnrichmentSweep({
      store,
      providers: [provider("deezer", async () => HIT)],
      batchSize: 1,
      sleep: sleep(),
      budgetMs: 100,
      startedAt: 0,
      now: () => (clock += 120),
    });

    expect(result.processed).toBe(1);
    expect(result.remaining).toBe(2);
    expect(result.done).toBe(false);
  });

  it("gives up rather than spinning when every provider is down", async () => {
    const store = await storeWithTracks("One", "Two");
    const failing = provider("deezer", async () => {
      throw new Error("Deezer responded 503");
    });

    const result = await drainEnrichmentSweep({
      store,
      providers: [failing],
      batchSize: 2,
      sleep: sleep(),
    });

    expect(result.deferred).toBe(2);
    expect(result.remaining).toBe(2);
    expect(failing.calls).toEqual(["One", "Two"]);
  });
});

describe("a track a provider matched but had no cover for", () => {
  it("comes back around once the retry window has passed", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
      const store = await storeWithTracks("Weird Fishes");
      const durationOnly = provider("deezer", async () => ({
        durationMs: 261_000,
        artworkUrl: null,
      }));

      await runEnrichmentSweep({
        store,
        providers: [durationOnly],
        sleep: sleep(),
      });
      expect([...store.tracks.values()][0].artworkUrl).toBeNull();

      // Same day: already attempted, so it stays out of the way.
      const sameDay = await runEnrichmentSweep({
        store,
        providers: [durationOnly],
        sleep: sleep(),
      });
      expect(sameDay.processed).toBe(0);

      vi.setSystemTime(new Date("2026-09-05T00:00:00Z"));
      const later = await runEnrichmentSweep({
        store,
        providers: [provider("deezer", async () => HIT)],
        sleep: sleep(),
      });

      expect(later.processed).toBe(1);
      expect([...store.tracks.values()][0].artworkUrl).toBe(
        "https://cdn.example/cover.jpg",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not stripped of artwork by a later duration-only hit", async () => {
    const store = await storeWithTracks("Weird Fishes");
    const [key] = [...store.tracks.keys()];

    await store.recordEnrichment(key, {
      durationMs: null,
      artworkUrl: "https://cdn.example/cover.jpg",
      source: "musicbrainz",
    });
    await store.recordEnrichment(key, {
      durationMs: 261_000,
      artworkUrl: null,
      source: "deezer",
    });

    const track = store.tracks.get(key)!;
    expect(track.artworkUrl).toBe("https://cdn.example/cover.jpg");
    expect(track.durationMs).toBe(261_000);
  });
});
