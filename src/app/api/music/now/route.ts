import type { LastfmPlay } from "@/widgets/music/lastfm/client";
import { ingestPlays } from "@/widgets/music/server/ingest";
import { readNowPlaying } from "@/widgets/music/server/now";
import { createDrizzleStore } from "@/widgets/music/server/store";

export async function GET() {
  return nowPlayingResponse(await readNowPlaying());
}

export async function POST() {
  let inserted = 0;
  const nowPlaying = await readNowPlaying({
    onFreshPlays: async (plays) => {
      inserted = await catchUp(plays);
    },
  });
  return nowPlayingResponse(nowPlaying, { inserted });
}

function nowPlayingResponse(
  nowPlaying: Awaited<ReturnType<typeof readNowPlaying>>,
  extra: { inserted?: number } = {},
) {
  return Response.json(
    { nowPlaying, ...extra },
    { headers: { "cache-control": "no-store" } },
  );
}

async function catchUp(plays: readonly LastfmPlay[]): Promise<number> {
  const store = createDrizzleStore();
  const startedAt = new Date();

  try {
    const result = await ingestPlays(store, plays);
    await store.writeJob("catchup", {
      status: "ok",
      lastRunAt: startedAt,
      lastError: null,
      cursor: { considered: result.considered, inserted: result.inserted },
    });
    return result.inserted;
  } catch (error) {
    const message = error instanceof Error ? error.message : "catchup-failed";

    try {
      await store.writeJob("catchup", {
        status: "error",
        lastRunAt: startedAt,
        lastError: message,
      });
    } catch {
    }

    throw error;
  }
}
