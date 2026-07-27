import {
  isTimeRange,
  recentlyPlayed,
  summary,
  topAlbums,
  topArtists,
  topTracks,
  type TimeRange,
} from "../queries/aggregations";

/**
 * Read handler for the music widget's aggregate surfaces.
 *
 * Mounted at `app/api/music/route.ts` (KTD2). Every branch reads local storage
 * only, so these responses are unaffected by last.fm being unreachable (AE8).
 */

export const MUSIC_SUB_VIEWS = ["recent", "artists", "albums", "tracks"] as const;
export type MusicSubView = (typeof MUSIC_SUB_VIEWS)[number];

function isSubView(value: unknown): value is MusicSubView {
  return MUSIC_SUB_VIEWS.includes(value as MusicSubView);
}

export type MusicPayload =
  | { view: "recent"; items: Awaited<ReturnType<typeof recentlyPlayed>> }
  | { view: "artists"; range: TimeRange; items: Awaited<ReturnType<typeof topArtists>> }
  | { view: "albums"; range: TimeRange; items: Awaited<ReturnType<typeof topAlbums>> }
  | { view: "tracks"; range: TimeRange; items: Awaited<ReturnType<typeof topTracks>> };

export async function handleMusicRead(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const view = params.get("view") ?? "recent";
  const rangeParam = params.get("range") ?? "week";
  const limit = Math.min(Number(params.get("limit")) || 50, 200);

  if (!isSubView(view)) {
    return Response.json({ error: "unknown-view" }, { status: 400 });
  }

  const range: TimeRange = isTimeRange(rangeParam) ? rangeParam : "week";

  // A short cache: these change at most once a day via the cron, and the
  // freshness-critical surfaces are served by /api/music/now instead.
  const headers = { "cache-control": "public, max-age=60, s-maxage=300" };

  try {
    // Concurrent, not sequential: the summary does not depend on the view, and
    // awaiting them in turn spent two round trips to the pooler where one
    // would do.
    const [payload, totals] = await Promise.all([
      readView(view, range, limit),
      summary(),
    ]);
    return Response.json({ ...payload, summary: totals }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "music-read-failed" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

async function readView(
  view: MusicSubView,
  range: TimeRange,
  limit: number,
): Promise<MusicPayload> {
  switch (view) {
    case "recent":
      return { view, items: await recentlyPlayed({ limit }) };
    case "artists":
      return { view, range, items: await topArtists(range, { limit }) };
    case "albums":
      return { view, range, items: await topAlbums(range, { limit }) };
    case "tracks":
      return { view, range, items: await topTracks(range, { limit }) };
  }
}
