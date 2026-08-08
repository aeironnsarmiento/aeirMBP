import { requireOwner } from "@/lib/auth/guard";
import { drainArtistSweep } from "@/widgets/music/enrichment/artists";
import { runEnrichmentSweep } from "@/widgets/music/enrichment/sweep";
import { createDrizzleStore } from "@/widgets/music/server/store";

export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const store = createDrizzleStore();
    const [tracks, artists] = await Promise.all([
      store.countPendingEnrichment(),
      store.countPendingArtists(),
    ]);

    return Response.json(
      { remaining: tracks + artists, tracks, artists },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("enrichment-status-failed", error);
    return Response.json(
      { error: "enrichment-status-failed" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST() {
  const denied = await requireOwner();
  if (denied) return denied;

  const startedAt = Date.now();

  try {
    const tracks = await runEnrichmentSweep();
    const artists = await drainArtistSweep({
      startedAt,
      budgetMs: TIME_BUDGET_MS,
    });

    return Response.json(
      {
        tracks,
        artists,
        remaining: tracks.remaining + artists.remaining,
        done: tracks.done && artists.done,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("sweep-failed", error);
    return Response.json(
      { error: "sweep-failed" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
