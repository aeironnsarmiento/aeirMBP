// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readNowPlaying } = vi.hoisted(() => ({ readNowPlaying: vi.fn() }));

vi.mock("@/widgets/music/server/now", () => ({ readNowPlaying }));
vi.mock("@/widgets/music/server/ingest", () => ({ ingestPlays: vi.fn() }));
vi.mock("@/widgets/music/server/store", () => ({ createDrizzleStore: vi.fn() }));

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
