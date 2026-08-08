import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NowPlaying as NowPlayingValue } from "@/widgets/music/server/now";
import { NowPlaying } from "../NowPlaying/NowPlaying";

/**
 * The pulse's polling cadence.
 *
 * Worth its own test because the request it issues is also the site's only
 * continuous write: `/api/music/now` is what keeps the stored history current
 * between daily cron runs. A poll that does not fire is not a stale indicator,
 * it is a gap in the history.
 *
 * `waitFor` is deliberately unused here — it polls on real timers and
 * deadlocks against the fake ones this file needs. The first poll starts
 * synchronously inside the effect, so the call count can be read directly, and
 * `act` flushes the microtasks that follow.
 */

const INITIAL: NowPlayingValue = {
  track: "Weird Fishes",
  artist: "Radiohead",
  album: "In Rainbows",
  artworkUrl: null,
  live: true,
  playedAt: null,
  source: "lastfm",
};

function response(value: NowPlayingValue | null) {
  return { ok: true, json: async () => ({ nowPlaying: value }) } as Response;
}

/** Lets the poll's promise chain settle without advancing the clock. */
const settle = () => act(async () => { await Promise.resolve(); });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => response(INITIAL));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("polling", () => {
  it("polls once immediately on mount (R4)", async () => {
    render(<NowPlaying initial={INITIAL} />);

    // Not after thirty seconds — a visit shorter than the interval still has to
    // contribute its catch-up write.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/music/now", {
      method: "POST",
      cache: "no-store",
    });
    await settle();
  });

  it("keeps polling on the interval after the first", async () => {
    render(<NowPlaying initial={INITIAL} />);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops polling once unmounted", async () => {
    const { unmount } = render(<NowPlaying initial={INITIAL} />);
    await settle();
    unmount();

    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the last known value when a poll fails, rather than blanking", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<NowPlaying initial={INITIAL} />);
    await settle();

    expect(screen.getByText("Weird Fishes")).toBeInTheDocument();
  });

  it("renders nothing when there is no pulse to show", () => {
    const { container } = render(<NowPlaying initial={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
