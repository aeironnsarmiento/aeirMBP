import { requireOwner } from "@/lib/auth/guard";
import { runArtistSweep } from "@/widgets/music/enrichment/artists";
import { runEnrichmentSweep } from "@/widgets/music/enrichment/sweep";
import { createDrizzleStore } from "@/widgets/music/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** MusicBrainz's 1 req/sec floor makes a batch slow even when it is small. */
export const maxDuration = 60;

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
 * Advances both sweeps by one bounded batch.
 *
 * Tracks first: durations feed the listening-time total the panel leads with,
 * and an artist portrait is cosmetic beside it.
 */
export async function POST() {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const tracks = await runEnrichmentSweep();
    const artists = await runArtistSweep();

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
