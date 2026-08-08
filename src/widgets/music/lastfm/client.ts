const API_ROOT = "https://ws.audioscrobbler.com/2.0/";

export const MAX_PAGE_SIZE = 200;

export class LastfmError extends Error {
  readonly status: number | undefined;
  readonly code: number | undefined;

  constructor(message: string, options: { status?: number; code?: number } = {}) {
    super(message);
    this.name = "LastfmError";
    this.status = options.status;
    this.code = options.code;
  }
}

export type LastfmPlay = {
  artist: string;
  track: string;
  album: string | null;
  imageUrl: string | null;
  playedAt: Date | null;
  nowPlaying: boolean;
};

export type RecentTracksPage = {
  plays: LastfmPlay[];
  page: number;
  totalPages: number;
  total: number;
};

type RawImage = { size?: string; "#text"?: string };

type RawTrack = {
  name?: string;
  artist?: { "#text"?: string; name?: string } | string;
  album?: { "#text"?: string } | string;
  image?: RawImage[];
  date?: { uts?: string };
  "@attr"?: { nowplaying?: string };
};

type RawRecentTracks = {
  recenttracks?: {
    track?: RawTrack | RawTrack[];
    "@attr"?: { page?: string; totalPages?: string; total?: string };
  };
  error?: number;
  message?: string;
};

function textOf(value: { "#text"?: string; name?: string } | string | undefined) {
  if (typeof value === "string") return value;
  return value?.["#text"] ?? value?.name ?? "";
}

function bestImage(images: RawImage[] | undefined): string | null {
  if (!images?.length) return null;
  const order = ["extralarge", "large", "medium", "small"];
  for (const size of order) {
    const match = images.find((image) => image.size === size)?.["#text"];
    if (match) return match;
  }
  return images.at(-1)?.["#text"] || null;
}

function parseTrack(raw: RawTrack): LastfmPlay | null {
  const artist = textOf(raw.artist).trim();
  const track = (raw.name ?? "").trim();
  if (!artist || !track) return null;

  const album = textOf(raw.album).trim() || null;
  const nowPlaying = raw["@attr"]?.nowplaying === "true";
  const uts = raw.date?.uts ? Number(raw.date.uts) : NaN;

  return {
    artist,
    track,
    album,
    imageUrl: bestImage(raw.image),
    playedAt: Number.isFinite(uts) ? new Date(uts * 1000) : null,
    nowPlaying: nowPlaying || !Number.isFinite(uts),
  };
}

function apiKey(): string {
  const key = process.env.LASTFM_API_KEY;
  if (!key) throw new LastfmError("LASTFM_API_KEY is not set");
  return key;
}

function username(): string {
  const user = process.env.LASTFM_USER;
  if (!user) throw new LastfmError("LASTFM_USER is not set");
  return user;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export type FetchOptions = {
  attempts?: number;
  backoffMs?: number;
  signal?: AbortSignal;
};

async function callApi(
  params: Record<string, string>,
  { attempts = 3, backoffMs = 500, signal }: FetchOptions = {},
): Promise<unknown> {
  const url = new URL(API_ROOT);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("format", "json");

  let lastError: LastfmError | undefined;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        signal,
        headers: { accept: "application/json" },
        cache: "no-store",
      });
    } catch (cause) {
      lastError = new LastfmError(`last.fm request failed: ${String(cause)}`);
      if (attempt === attempts) break;
      await wait(backoffMs * 2 ** (attempt - 1));
      continue;
    }

    if (!response.ok) {
      lastError = new LastfmError(
        `last.fm responded ${response.status}`,
        { status: response.status },
      );
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === attempts) break;
      await wait(backoffMs * 2 ** (attempt - 1));
      continue;
    }

    const body = (await response.json()) as { error?: number; message?: string };

    if (typeof body?.error === "number") {
      throw new LastfmError(body.message ?? `last.fm error ${body.error}`, {
        code: body.error,
      });
    }

    return body;
  }

  throw lastError ?? new LastfmError("last.fm request failed");
}

export type RecentTracksQuery = {
  page?: number;
  limit?: number;
  from?: number;
  to?: number;
};

export async function getRecentTracks(
  query: RecentTracksQuery = {},
  options: FetchOptions = {},
): Promise<RecentTracksPage> {
  const limit = Math.min(query.limit ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  const params: Record<string, string> = {
    method: "user.getrecenttracks",
    user: username(),
    limit: String(limit),
    page: String(query.page ?? 1),
    extended: "0",
  };
  if (query.from !== undefined) params.from = String(query.from);
  if (query.to !== undefined) params.to = String(query.to);

  const body = (await callApi(params, options)) as RawRecentTracks;
  const recent = body.recenttracks;

  if (!recent) {
    throw new LastfmError("last.fm returned no recenttracks payload");
  }

  const rawTracks = Array.isArray(recent.track)
    ? recent.track
    : recent.track
      ? [recent.track]
      : [];

  return {
    plays: rawTracks
      .map(parseTrack)
      .filter((play): play is LastfmPlay => play !== null),
    page: Number(recent["@attr"]?.page ?? 1),
    totalPages: Number(recent["@attr"]?.totalPages ?? 1),
    total: Number(recent["@attr"]?.total ?? 0),
  };
}

export async function getNowPlaying(
  options: FetchOptions = {},
): Promise<LastfmPlay | null> {
  const page = await getRecentTracks({ limit: 1, page: 1 }, options);
  const first = page.plays[0];
  return first?.nowPlaying ? first : null;
}
