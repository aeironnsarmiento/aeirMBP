import {
  isTimeRange,
  recentlyPlayed,
  summary,
  topAlbums,
  topArtists,
  topTracks,
  type TimeRange,
} from "../queries/aggregations";

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

  const headers = { "cache-control": "public, max-age=60, s-maxage=300" };

  try {
    const [payload, totals] = await Promise.all([
      readView(view, range, limit),
      summary(),
    ]);
    return Response.json({ ...payload, summary: totals }, { headers });
  } catch (error) {
    console.error("music-read-failed", error);
    return Response.json(
      { error: "music-read-failed" },
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
