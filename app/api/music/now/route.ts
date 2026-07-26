import { readNowPlaying } from "@/widgets/music/server/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin mount for the now-playing pulse.
 *
 * `no-store` at the edge because the freshness this surface exists for would
 * be destroyed by a CDN cache; the short in-process cache inside
 * `readNowPlaying` is what keeps last.fm from being hammered.
 */
export async function GET() {
  return Response.json(
    { nowPlaying: await readNowPlaying() },
    { headers: { "cache-control": "no-store" } },
  );
}
