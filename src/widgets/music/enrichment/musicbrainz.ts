import type { PendingTrack } from "../server/store";
import type { EnrichmentProvider, ProviderResult } from "./provider";

const RECORDING_URL = "https://musicbrainz.org/ws/2/recording";
const COVER_ART_URL = "https://coverartarchive.org/release";

const MIN_INTERVAL_MS = 1_100;

const USER_AGENT =
  "xenComp/0.1 ( https://www.last.fm/user/xenavalon ) personal-site-metadata";

type MusicBrainzRecording = {
  length?: number | null;
  releases?: Array<{ id?: string }>;
};

type MusicBrainzResponse = {
  recordings?: MusicBrainzRecording[];
};

function escapeLucene(value: string): string {
  return value.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, "\\$1");
}

async function coverArtUrl(
  releaseId: string,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const url = `${COVER_ART_URL}/${releaseId}/front-500`;
  const response = await fetch(url, {
    method: "HEAD",
    redirect: "manual",
    signal,
    headers: { "user-agent": USER_AGENT },
    cache: "no-store",
  });

  const found = response.status === 307 || response.status === 302 || response.ok;
  return found ? url : null;
}

export function createMusicBrainzProvider(
  options: { signal?: AbortSignal } = {},
): EnrichmentProvider {
  return {
    name: "musicbrainz",
    minIntervalMs: MIN_INTERVAL_MS,

    async lookup(track: PendingTrack): Promise<ProviderResult | null> {
      const query = `artist:"${escapeLucene(track.artistName)}" AND recording:"${escapeLucene(
        track.trackName,
      )}"`;

      const url = new URL(RECORDING_URL);
      url.searchParams.set("query", query);
      url.searchParams.set("fmt", "json");
      url.searchParams.set("limit", "1");

      const response = await fetch(url, {
        signal: options.signal,
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`MusicBrainz responded ${response.status}`);
      }

      const body = (await response.json()) as MusicBrainzResponse;
      const recording = body.recordings?.[0];
      if (!recording) return null;

      const durationMs =
        typeof recording.length === "number" && recording.length > 0
          ? recording.length
          : null;

      const releaseId = recording.releases?.[0]?.id;
      const artworkUrl = releaseId
        ? await coverArtUrl(releaseId, options.signal)
        : null;

      if (durationMs === null && artworkUrl === null) return null;
      return { durationMs, artworkUrl };
    },
  };
}
