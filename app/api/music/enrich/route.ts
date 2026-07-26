import { requireOwner } from "@/lib/auth/guard";
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
  return Response.json(
    { remaining: await store.countPendingEnrichment() },
    { headers: { "cache-control": "no-store" } },
  );
}

/** Advances the sweep by one bounded batch. */
export async function POST() {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    return Response.json(await runEnrichmentSweep(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "sweep-failed" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
