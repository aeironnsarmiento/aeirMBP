import { requireCronSecret } from "@/lib/auth/guard";
import { drainArtistSweep } from "@/widgets/music/enrichment/artists";
import { drainEnrichmentSweep } from "@/widgets/music/enrichment/sweep";

export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const startedAt = Date.now();

  try {
    // Tracks first: a blank cover is the visible failure, an artist portrait is not.
    const tracks = await drainEnrichmentSweep({
      startedAt,
      budgetMs: TIME_BUDGET_MS,
    });
    const artists = await drainArtistSweep({
      startedAt,
      budgetMs: TIME_BUDGET_MS,
    });

    return Response.json(
      {
        ok: true,
        tracks,
        artists,
        remaining: tracks.remaining + artists.remaining,
        done: tracks.done && artists.done,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("cron-enrich-failed", error);
    return Response.json(
      { ok: false, error: "cron-enrich-failed" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
