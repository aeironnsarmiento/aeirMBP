// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LastfmError, getNowPlaying, getRecentTracks } from "./client";

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function trackPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "Weird Fishes",
    artist: { "#text": "Radiohead" },
    album: { "#text": "In Rainbows" },
    image: [
      { size: "small", "#text": "https://img/s.png" },
      { size: "extralarge", "#text": "https://img/xl.png" },
    ],
    date: { uts: "1784894400" },
    ...overrides,
  };
}

function page(tracks: unknown, attr: Record<string, string> = {}) {
  return {
    recenttracks: {
      track: tracks,
      "@attr": { page: "1", totalPages: "37", total: "7338", ...attr },
    },
  };
}

beforeEach(() => {
  process.env.LASTFM_API_KEY = "test-key";
  process.env.LASTFM_USER = "xenavalon";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LASTFM_API_KEY;
  delete process.env.LASTFM_USER;
});

describe("parsing a page of plays", () => {
  it("maps artist, track, album, artwork and timestamp", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(page([trackPayload()]))));

    const result = await getRecentTracks();

    expect(result.totalPages).toBe(37);
    expect(result.total).toBe(7338);
    expect(result.plays).toHaveLength(1);
    expect(result.plays[0]).toMatchObject({
      artist: "Radiohead",
      track: "Weird Fishes",
      album: "In Rainbows",
      imageUrl: "https://img/xl.png",
      nowPlaying: false,
    });
    expect(result.plays[0].playedAt?.toISOString()).toBe(
      new Date(1784894400 * 1000).toISOString(),
    );
  });

  it("handles a single result returned as an object rather than an array", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(page(trackPayload()))));

    const result = await getRecentTracks({ limit: 1 });

    expect(result.plays).toHaveLength(1);
    expect(result.plays[0].track).toBe("Weird Fishes");
  });

  it("marks the currently-playing entry and leaves it without a timestamp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(
          page([
            trackPayload({
              date: undefined,
              "@attr": { nowplaying: "true" },
            }),
            trackPayload(),
          ]),
        ),
      ),
    );

    const result = await getRecentTracks();

    expect(result.plays[0].nowPlaying).toBe(true);
    expect(result.plays[0].playedAt).toBeNull();
    expect(result.plays[1].nowPlaying).toBe(false);
  });

  it("drops an entry missing an artist or a track name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(
          page([
            trackPayload({ name: "" }),
            trackPayload({ artist: { "#text": "" } }),
            trackPayload(),
          ]),
        ),
      ),
    );

    expect((await getRecentTracks()).plays).toHaveLength(1);
  });

  it("caps the page size at the documented maximum", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => respond(page([])));
    vi.stubGlobal("fetch", fetchMock);

    await getRecentTracks({ limit: 1000 });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("limit")).toBe("200");
  });

  it("passes the from bound through so a gap can be recovered", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => respond(page([])));
    vi.stubGlobal("fetch", fetchMock);

    await getRecentTracks({ from: 1784894400, page: 3 });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("from")).toBe("1784894400");
    expect(url.searchParams.get("page")).toBe("3");
  });
});

describe("errors propagate rather than reading as an empty page", () => {
  it("throws on an application error returned with HTTP 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond({ error: 6, message: "User not found" }),
      ),
    );

    await expect(getRecentTracks()).rejects.toBeInstanceOf(LastfmError);
    await expect(getRecentTracks()).rejects.toThrow("User not found");
  });

  it("throws when the payload carries no recenttracks object", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({})));

    await expect(getRecentTracks()).rejects.toBeInstanceOf(LastfmError);
  });

  it("does not retry a client error", async () => {
    const fetchMock = vi.fn(async () => respond({}, 403));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getRecentTracks({}, { attempts: 3, backoffMs: 1 })).rejects.toThrow(
      /403/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a rate-limit response and succeeds when it clears", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond({}, 429))
      .mockResolvedValueOnce(respond(page([trackPayload()])));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getRecentTracks({}, { attempts: 3, backoffMs: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.plays).toHaveLength(1);
  });

  it("gives up after the configured number of attempts", async () => {
    const fetchMock = vi.fn(async () => respond({}, 503));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getRecentTracks({}, { attempts: 2, backoffMs: 1 }),
    ).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses to call the API without credentials", async () => {
    delete process.env.LASTFM_API_KEY;

    await expect(getRecentTracks()).rejects.toThrow(/LASTFM_API_KEY/);
  });
});

describe("now playing", () => {
  it("returns the live entry when one is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(
          page(
            trackPayload({ date: undefined, "@attr": { nowplaying: "true" } }),
          ),
        ),
      ),
    );

    expect((await getNowPlaying())?.nowPlaying).toBe(true);
  });

  it("returns null when the most recent entry is a completed play", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(page(trackPayload()))));

    expect(await getNowPlaying()).toBeNull();
  });
});
