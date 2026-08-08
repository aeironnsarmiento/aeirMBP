import type { PendingTrack } from "../server/store";
import type { EnrichmentProvider, ProviderResult } from "./provider";

const SEARCH_URL = "https://api.deezer.com/search";

const MIN_INTERVAL_MS = 200;

type DeezerTrack = {
  duration?: number;
  album?: {
    cover_xl?: string;
    cover_big?: string;
    cover_medium?: string;
  };
};

type DeezerSearchResponse = {
  data?: DeezerTrack[];
  total?: number;
  error?: unknown;
};

function bestCover(album: DeezerTrack["album"]): string | null {
  return album?.cover_xl || album?.cover_big || album?.cover_medium || null;
}

function sanitize(value: string): string {
  return value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
}

async function search(
  query: string,
  signal: AbortSignal | undefined,
): Promise<DeezerTrack | null> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");

  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Deezer responded ${response.status}`);
  }

  const body = (await response.json()) as DeezerSearchResponse;
  if (body.error) throw new Error("Deezer returned an error payload");

  return body.data?.[0] ?? null;
}

type DeezerArtist = {
  name?: string;
  nb_fan?: number;
  picture_xl?: string;
  picture_big?: string;
  picture_medium?: string;
};

const ARTIST_SEARCH_URL = "https://api.deezer.com/search/artist";

const ARTIST_CANDIDATES = 10;

function bestPicture(artist: DeezerArtist | undefined): string | null {
  return (
    artist?.picture_xl || artist?.picture_big || artist?.picture_medium || null
  );
}

export function chooseArtist(
  candidates: readonly DeezerArtist[],
  wanted: string,
): DeezerArtist | undefined {
  const target = wanted.trim().toLowerCase();
  const exact = candidates.filter(
    (candidate) => candidate.name?.trim().toLowerCase() === target,
  );

  const pool = exact.length > 0 ? exact : candidates;
  return [...pool].sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0))[0];
}

export async function lookupArtistPicture(
  artistName: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const artist = sanitize(artistName);
  if (!artist) return null;

  const url = new URL(ARTIST_SEARCH_URL);
  url.searchParams.set("q", artist);
  url.searchParams.set("limit", String(ARTIST_CANDIDATES));

  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Deezer responded ${response.status}`);

  const body = (await response.json()) as {
    data?: DeezerArtist[];
    error?: unknown;
  };
  if (body.error) throw new Error("Deezer returned an error payload");

  return bestPicture(chooseArtist(body.data ?? [], artist));
}

export function createDeezerProvider(
  options: { signal?: AbortSignal } = {},
): EnrichmentProvider {
  return {
    name: "deezer",
    minIntervalMs: MIN_INTERVAL_MS,

    async lookup(track: PendingTrack): Promise<ProviderResult | null> {
      const artist = sanitize(track.artistName);
      const title = sanitize(track.trackName);
      if (!artist || !title) return null;

      let hit = await search(`artist:"${artist}" track:"${title}"`, options.signal);
      if (!hit) hit = await search(`${artist} ${title}`, options.signal);
      if (!hit) return null;

      const durationSeconds = hit.duration;
      return {
        durationMs:
          typeof durationSeconds === "number" && durationSeconds > 0
            ? durationSeconds * 1000
            : null,
        artworkUrl: bestCover(hit.album),
      };
    },
  };
}
