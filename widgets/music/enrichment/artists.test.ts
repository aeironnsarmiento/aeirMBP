// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../server/store.memory";
import { runArtistSweep } from "./artists";
import { chooseArtist } from "./deezer";

const noSleep = async () => {};

function storeWithPlays(plays: Array<{ artist: string; count: number }>) {
  const store = createMemoryStore();
  let at = 0;
  for (const { artist, count } of plays) {
    for (let i = 0; i < count; i += 1) {
      at += 1;
      store.scrobbles.push({
        trackKey: `${artist}::t${i}`,
        artistKey: artist.toLowerCase(),
        albumKey: null,
        artistName: artist,
        trackName: `t${i}`,
        albumName: null,
        playedAt: new Date(at * 1000),
      });
    }
  }
  return store;
}

describe("artist portrait sweep", () => {
  it("stores a portrait for each artist it can resolve", async () => {
    const store = storeWithPlays([{ artist: "Ado", count: 3 }]);
    const lookup = vi.fn(async () => "https://cdn.example/ado.jpg");

    const result = await runArtistSweep({ store, lookup, sleep: noSleep });

    expect(result.enriched).toBe(1);
    expect(result.remaining).toBe(0);
    expect(store.artists.get("ado")?.pictureUrl).toBe(
      "https://cdn.example/ado.jpg",
    );
    expect(store.artists.get("ado")?.source).toBe("deezer");
  });

  it("looks an artist up once and never again", async () => {
    const store = storeWithPlays([{ artist: "Ado", count: 2 }]);
    const lookup = vi.fn(async () => "https://cdn.example/ado.jpg");

    await runArtistSweep({ store, lookup, sleep: noSleep });
    await runArtistSweep({ store, lookup, sleep: noSleep });

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("marks a miss so it is not retried forever", async () => {
    const store = storeWithPlays([{ artist: "Obscure", count: 1 }]);
    const lookup = vi.fn(async () => null);

    const first = await runArtistSweep({ store, lookup, sleep: noSleep });
    const second = await runArtistSweep({ store, lookup, sleep: noSleep });

    expect(first.missed).toBe(1);
    expect(second.processed).toBe(0);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("leaves an artist pending when the lookup fails transiently", async () => {
    const store = storeWithPlays([{ artist: "Ado", count: 1 }]);
    const failing = vi.fn(async () => {
      throw new Error("network");
    });

    const result = await runArtistSweep({
      store,
      lookup: failing,
      sleep: noSleep,
    });

    // A transient outage must not strand the artist on the initials tile with
    // nothing to indicate why.
    expect(result.deferred).toBe(1);
    expect(result.remaining).toBe(1);
    expect(store.artists.has("ado")).toBe(false);
  });

  it("takes the most-played artists first, so the visible list fills first", async () => {
    const store = storeWithPlays([
      { artist: "Rare", count: 1 },
      { artist: "Constant", count: 9 },
      { artist: "Middling", count: 4 },
    ]);
    const seen: string[] = [];
    const lookup = vi.fn(async (name: string) => {
      seen.push(name);
      return "https://cdn.example/x.jpg";
    });

    await runArtistSweep({ store, lookup, batchSize: 2, sleep: noSleep });

    expect(seen).toEqual(["Constant", "Middling"]);
  });

  it("honours the batch size and reports what is left", async () => {
    const store = storeWithPlays([
      { artist: "A", count: 3 },
      { artist: "B", count: 2 },
      { artist: "C", count: 1 },
    ]);
    const lookup = vi.fn(async () => "https://cdn.example/x.jpg");

    const result = await runArtistSweep({
      store,
      lookup,
      batchSize: 2,
      sleep: noSleep,
    });

    expect(result.processed).toBe(2);
    expect(result.remaining).toBe(1);
    expect(result.done).toBe(false);
  });

  it("reports done against an empty store", async () => {
    const result = await runArtistSweep({
      store: createMemoryStore(),
      lookup: vi.fn(),
      sleep: noSleep,
    });

    expect(result).toMatchObject({ processed: 0, remaining: 0, done: true });
  });

  it("paces its calls rather than hammering the provider", async () => {
    const store = storeWithPlays([
      { artist: "A", count: 2 },
      { artist: "B", count: 1 },
    ]);
    const sleep = vi.fn(async () => {});

    await runArtistSweep({
      store,
      lookup: async () => "https://cdn.example/x.jpg",
      sleep,
    });

    // One gap between two calls, not one before the first.
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});

describe("choosing which Deezer artist is the right one", () => {
  it("prefers an exact name over Deezer's own top hit", () => {
    // The shape the live API returns for "Ado": a 24-fan near-namesake ranks
    // above the artist with six figures of following.
    const chosen = chooseArtist(
      [
        { name: "Ado & Montorsi", nb_fan: 24 },
        { name: "Ado", nb_fan: 129_432 },
        { name: "A.D.O", nb_fan: 18 },
      ],
      "Ado",
    );

    expect(chosen?.name).toBe("Ado");
  });

  it("breaks a tie between identical names by following", () => {
    const chosen = chooseArtist(
      [
        { name: "Ado", nb_fan: 1_082 },
        { name: "Ado", nb_fan: 129_432 },
      ],
      "Ado",
    );

    expect(chosen?.nb_fan).toBe(129_432);
  });

  it("matches regardless of casing and surrounding space", () => {
    const chosen = chooseArtist(
      [
        { name: "Something Else", nb_fan: 900_000 },
        { name: "  gfriend ", nb_fan: 10 },
      ],
      "GFRIEND",
    );

    expect(chosen?.name?.trim()).toBe("gfriend");
  });

  it("falls back to the most followed candidate when nothing matches exactly", () => {
    const chosen = chooseArtist(
      [
        { name: "Adolescent's Orquesta", nb_fan: 9_919 },
        { name: "Ado & Montorsi", nb_fan: 24 },
      ],
      "Ado",
    );

    expect(chosen?.name).toBe("Adolescent's Orquesta");
  });

  it("returns nothing when Deezer knows no such artist", () => {
    expect(chooseArtist([], "Nobody")).toBeUndefined();
  });
});
