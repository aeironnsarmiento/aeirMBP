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
 */
export async function GET() {
  const nowPlaying = await readNowPlaying({
    onFreshPlays: (plays) => ingestPlays(createDrizzleStore(), plays).then(() => {}),
  });

  return Response.json(
    { nowPlaying },
    { headers: { "cache-control": "no-store" } },
  );
}
