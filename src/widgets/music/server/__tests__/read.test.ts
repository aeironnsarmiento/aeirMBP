// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { recentlyPlayed, summary } = vi.hoisted(() => ({
  recentlyPlayed: vi.fn(),
  summary: vi.fn(),
}));

vi.mock("../../queries/aggregations", () => ({
  isTimeRange: vi.fn(() => true),
  recentlyPlayed,
  summary,
  topAlbums: vi.fn(),
  topArtists: vi.fn(),
  topTracks: vi.fn(),
}));

import { handleMusicRead } from "../read";

beforeEach(() => {
  recentlyPlayed.mockReset();
  summary.mockReset();
});

describe("public failure responses", () => {
  it("logs the underlying error without returning it to the client", async () => {
    const failure = new Error("database host and credential details");
    recentlyPlayed.mockRejectedValue(failure);
    summary.mockResolvedValue({});
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handleMusicRead(
      new Request("https://example.test/api/music?view=recent"),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "music-read-failed" });
    expect(log).toHaveBeenCalledWith("music-read-failed", failure);

    log.mockRestore();
  });
});

describe("cache policy", () => {
  it("never caches recent plays, so every limit sees the same history", async () => {
    recentlyPlayed.mockResolvedValue([]);
    summary.mockResolvedValue({});

    for (const limit of ["5", "60"]) {
      const response = await handleMusicRead(
        new Request(`https://example.test/api/music?view=recent&limit=${limit}`),
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});
