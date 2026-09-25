// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readNowPlaying, ingestPlays } = vi.hoisted(() => ({
  readNowPlaying: vi.fn(),
  ingestPlays: vi.fn(),
}));

vi.mock("@/widgets/music/server/now", () => ({ readNowPlaying }));
vi.mock("@/widgets/music/server/ingest", () => ({ ingestPlays }));
vi.mock("@/widgets/music/server/store", () => ({
  createDrizzleStore: () => ({ writeJob: vi.fn() }),
}));

import { GET, POST } from "../route";

beforeEach(() => {
  readNowPlaying.mockReset();
  readNowPlaying.mockResolvedValue(null);
});

describe("now-playing HTTP semantics", () => {
  it("keeps GET read-only", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(readNowPlaying).toHaveBeenCalledWith();
  });

  it("attaches catch-up persistence only to POST", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    expect(readNowPlaying).toHaveBeenCalledWith({
      onFreshPlays: expect.any(Function),
    });
  });
});

describe("catch-up reporting", () => {
  it("returns how many plays the catch-up stored", async () => {
    ingestPlays.mockResolvedValue({ considered: 50, inserted: 3 });
    readNowPlaying.mockImplementation(async ({ onFreshPlays }) => {
      await onFreshPlays([]);
      return null;
    });

    const body = await (await POST()).json();

    expect(body.inserted).toBe(3);
  });

  it("reports zero when this request did no catch-up", async () => {
    const body = await (await POST()).json();

    expect(body.inserted).toBe(0);
  });
});
