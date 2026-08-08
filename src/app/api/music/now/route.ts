import type { LastfmPlay } from "@/widgets/music/lastfm/client";
import { ingestPlays } from "@/widgets/music/server/ingest";
import { readNowPlaying } from "@/widgets/music/server/now";
import { createDrizzleStore } from "@/widgets/music/server/store";

export async function GET() {
  return nowPlayingResponse(await readNowPlaying());
}

export async function POST() {
  return nowPlayingResponse(await readNowPlaying({ onFreshPlays: catchUp }));
}

function nowPlayingResponse(nowPlaying: Awaited<ReturnType<typeof readNowPlaying>>) {
  return Response.json(
    { nowPlaying },
    { headers: { "cache-control": "no-store" } },
  );
}

async function catchUp(plays: readonly LastfmPlay[]): Promise<void> {
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
