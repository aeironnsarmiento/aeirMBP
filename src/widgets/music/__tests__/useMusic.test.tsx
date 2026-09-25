import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markMusicStale } from "../freshness";
import { useMusic } from "../useMusic";

function Probe() {
  const state = useMusic({ view: "recent", limit: 5 });
  if (state.status !== "ready") return <p>loading</p>;
  const first = state.data.view === "recent" ? state.data.items[0] : null;
  return <p>{first?.trackName}</p>;
}

function payload(trackName: string) {
  return {
    ok: true,
    json: async () => ({
      view: "recent",
      items: [{ trackName }],
      summary: {},
    }),
  } as Response;
}

/** Lets the fetch's promise chain settle. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => payload("Weird Fishes"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("staying current", () => {
  it("fetches past the browser cache", async () => {
    render(<Probe />);
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/music?view=recent&limit=5",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("refetches when new plays are stored, without dropping to loading", async () => {
    render(<Probe />);
    await settle();
    expect(screen.getByText("Weird Fishes")).toBeInTheDocument();

    fetchMock.mockResolvedValue(payload("Reckoner"));
    act(() => markMusicStale());

    expect(screen.queryByText("loading")).not.toBeInTheDocument();
    expect(screen.getByText("Weird Fishes")).toBeInTheDocument();

    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Reckoner")).toBeInTheDocument();
  });
});
