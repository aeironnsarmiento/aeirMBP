import { requireOwner } from "@/lib/auth/guard";
import { drainArtistSweep } from "@/widgets/music/enrichment/artists";
import { runEnrichmentSweep } from "@/widgets/music/enrichment/sweep";
import { createDrizzleStore } from "@/widgets/music/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** MusicBrainz's 1 req/sec floor makes a batch slow even when it is small. */
export const maxDuration = 60;

/**
 * How long this handler may spend before returning, in milliseconds.
 *
 * Measured from the start of the request, not from the start of the artist
 * loop: the track sweep runs first in the same invocation and spends the same
 * budget. Ten seconds under `maxDuration` so a batch already in flight when
 * the budget runs out still has room to finish and record its result.
 */
const TIME_BUDGET_MS = 50_000;

/** How much work is left, for the Settings widget's status line. */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  const store = createDrizzleStore();
  const [tracks, artists] = await Promise.all([
    store.countPendingEnrichment(),
    store.countPendingArtists(),
  ]);

  return Response.json(
    { remaining: tracks + artists, tracks, artists },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * Advances the track sweep by one batch, then drains the artist sweep.
 *
 * Tracks first: durations feed the listening-time total the panel leads with,
 * and an artist portrait is cosmetic beside it. Tracks stay one batch per
 * request because MusicBrainz's 1 req/sec floor makes 25 of them a ~25-second
 * proposition on its own; artists run against Deezer's 200ms floor, so a few
 * hundred fit comfortably in what is left.
 *
 * The artist loop exists because one batch per click meant the owner had to
 * know how many clicks "done" was — and stopping early left artists showing an
 * album sleeve where a portrait belongs with nothing to say why.
 */
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
    return Response.json(
      { error: error instanceof Error ? error.message : "sweep-failed" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
