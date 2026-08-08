// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  countPendingEnrichment: vi.fn(),
  countPendingArtists: vi.fn(),
  requireOwner: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/widgets/music/enrichment/artists", () => ({
  drainArtistSweep: vi.fn(),
}));
vi.mock("@/widgets/music/enrichment/sweep", () => ({
  runEnrichmentSweep: vi.fn(),
}));
vi.mock("@/widgets/music/server/store", () => ({
  createDrizzleStore: () => ({
    countPendingEnrichment: mocks.countPendingEnrichment,
    countPendingArtists: mocks.countPendingArtists,
  }),
}));

import { GET } from "../route";

beforeEach(() => {
  mocks.countPendingEnrichment.mockReset();
  mocks.countPendingArtists.mockReset();
  mocks.requireOwner.mockReset();
  mocks.requireOwner.mockResolvedValue(null);
});

describe("enrichment status failures", () => {
  it("logs datastore details and returns a stable error code", async () => {
    const failure = new Error("database connection details");
    mocks.countPendingEnrichment.mockRejectedValue(failure);
    mocks.countPendingArtists.mockResolvedValue(0);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "enrichment-status-failed" });
    expect(log).toHaveBeenCalledWith("enrichment-status-failed", failure);

    log.mockRestore();
  });
});
