// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  drainEnrichmentSweep: vi.fn(),
  drainArtistSweep: vi.fn(),
}));

vi.mock("@/widgets/music/enrichment/sweep", () => ({
  drainEnrichmentSweep: mocks.drainEnrichmentSweep,
}));
vi.mock("@/widgets/music/enrichment/artists", () => ({
  drainArtistSweep: mocks.drainArtistSweep,
}));

import { GET } from "../route";

const SECRET = "cron-secret-value";

function request(authorization?: string): Request {
  return new Request("https://example.test/api/cron/enrich", {
    headers: authorization ? { authorization } : undefined,
  });
}

const sweepResult = {
  processed: 3,
  enriched: 3,
  missed: 0,
  deferred: 0,
  remaining: 0,
  done: true,
};

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  mocks.drainEnrichmentSweep.mockReset().mockResolvedValue(sweepResult);
  mocks.drainArtistSweep.mockReset().mockResolvedValue({
    ...sweepResult,
    processed: 0,
    enriched: 0,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the enrichment cron", () => {
  it("refuses a request without the cron bearer", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.drainEnrichmentSweep).not.toHaveBeenCalled();
  });

  it("refuses a wrong bearer", async () => {
    const response = await GET(request("Bearer not-the-secret"));

    expect(response.status).toBe(401);
    expect(mocks.drainEnrichmentSweep).not.toHaveBeenCalled();
  });

  it("drains tracks then artists and reports what is left", async () => {
    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      remaining: 0,
      done: true,
    });
    expect(mocks.drainEnrichmentSweep).toHaveBeenCalledTimes(1);
    expect(mocks.drainArtistSweep).toHaveBeenCalledTimes(1);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports a stable error code when a sweep throws", async () => {
    const failure = new Error("database connection details");
    mocks.drainEnrichmentSweep.mockRejectedValue(failure);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      ok: false,
      error: "cron-enrich-failed",
    });
    expect(log).toHaveBeenCalledWith("cron-enrich-failed", failure);

    log.mockRestore();
  });
});
