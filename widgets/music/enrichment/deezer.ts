import type { PendingTrack } from "../server/store";
import type { EnrichmentProvider, ProviderResult } from "./provider";

/**
 * Deezer's public search (KTD6).
 *
 * Primary source because it returns both `duration` and cover art up to
 * 1000x1000 with no API key, no OAuth and no subscription — nothing here can
 * lapse because an account changed. Verified during planning against a track
 * from the owner's own history.
 */

const SEARCH_URL = "https://api.deezer.com/search";

/** Deezer publishes a 50 requests / 5 seconds limit. This stays far under it. */
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

/** Deezer's query language mangles unescaped quotes; strip rather than escape. */
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

/** Deezer's ranking is fuzzy, so enough results to find an exact name in. */
const ARTIST_CANDIDATES = 10;

function bestPicture(artist: DeezerArtist | undefined): string | null {
  return (
    artist?.picture_xl || artist?.picture_big || artist?.picture_medium || null
  );
}

/**
 * Picks the artist actually being searched for.
 *
 * Deezer ranks by its own relevance, which is not name equality: searching
 * "Ado" returns a 24-fan act called "Ado & Montorsi" ahead of the Ado with
 * 129,000 followers. Preferring an exact name and then the largest following
 * is what stops a near-namesake's portrait being attached to the artist.
 */
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

/**
 * A portrait for one artist.
 *
 * Deezer's artist index is a different endpoint from the track search, and its
 * pictures are of the artist rather than a record they appear on — which is
 * the whole reason this exists instead of reusing a track's cover art.
 *
 * Returns null on a genuine miss and throws on a transport failure, so the
 * sweep can tell "no such artist" from "try again later".
 */
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

      // Field-scoped search first. It is precise but returns nothing when
      // either string carries punctuation Deezer indexes differently, so a
      // plain search is tried before giving up.
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
