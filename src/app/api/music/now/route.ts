import type { LastfmPlay } from "@/widgets/music/lastfm/client";
import { ingestPlays } from "@/widgets/music/server/ingest";
import { readNowPlaying } from "@/widgets/music/server/now";
import { createDrizzleStore } from "@/widgets/music/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin mount for the now-playing pulse, and the site's real ingestion path.
 *
 * `no-store` at the edge because the freshness this surface exists for would
 * be destroyed by a CDN cache; the short in-process cache inside
 * `readNowPlaying` is what keeps last.fm from being hammered.
 *
 * The plays it fetched are also written to the store. A Hobby-plan cron cannot
 * run more than once a day, so the daily job alone left "recently played" up
 * to twenty-four hours behind what the pulse was showing. This poll already
 * runs while someone is looking at the site — which is the moment the history
 * needs to be current — and ingestion is idempotent, so the repeat costs an
 * insert that conflicts and does nothing.
 *
 * This route is the only caller that attaches a writer. The server render
 * deliberately does not: a write has no business holding a page open.
 */
export async function GET() {
  const nowPlaying = await readNowPlaying({ onFreshPlays: catchUp });

  return Response.json(
    { nowPlaying },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * Persists the plays the pulse learned about, and records how it went.
 *
 * The recording is the point of the wrapper. Ingestion is allowed to fail
 * without taking the pulse down with it, but the previous version swallowed
 * the failure entirely — which is how four hours of scrobbles went missing
 * with nothing anywhere to say so. `music_job_state` already carries a status,
 * a timestamp and a last error for every other job; the catch-up gets the same
 * treatment under its own name.
 */
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

    // Best-effort: if the database is what failed, this write fails too. The
    // throw still propagates so `readNowPlaying` leaves the plays pending for
    // the next caller rather than marking them ingested.
    try {
      await store.writeJob("catchup", {
        status: "error",
        lastRunAt: startedAt,
        lastError: message,
      });
    } catch {
      // Nothing left to report it to.
    }

    throw error;
  }
}
