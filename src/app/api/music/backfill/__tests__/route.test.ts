// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readBackfillProgress: vi.fn(),
  requireOwner: vi.fn(),
  runBackfill: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/widgets/music/server/backfill", () => ({
  readBackfillProgress: mocks.readBackfillProgress,
  runBackfill: mocks.runBackfill,
}));

import { GET } from "../route";

beforeEach(() => {
  mocks.readBackfillProgress.mockReset();
  mocks.requireOwner.mockReset();
  mocks.requireOwner.mockResolvedValue(null);
});

describe("backfill status failures", () => {
  it("logs datastore details and returns a stable error code", async () => {
    const failure = new Error("database connection details");
    mocks.readBackfillProgress.mockRejectedValue(failure);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "backfill-read-failed" });
    expect(log).toHaveBeenCalledWith("backfill-read-failed", failure);

    log.mockRestore();
  });
});
