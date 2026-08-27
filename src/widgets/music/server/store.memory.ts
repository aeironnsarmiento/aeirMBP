import { ENRICHMENT_RETRY_AFTER_MS } from "./store";
import type {
  ArtistPicture,
  JobName,
  JobPatch,
  JobState,
  MusicStore,
  PendingTrack,
  ScrobbleRow,
  TrackEnrichment,
  TrackSeed,
} from "./store";

export type MemoryStore = MusicStore & {
  scrobbles: ScrobbleRow[];
  tracks: Map<
    string,
    TrackSeed & {
      durationMs: number | null;
      artworkUrl: string | null;
      source: string | null;
      enrichedAt: Date | null;
      attemptedAt: Date | null;
    }
  >;
  artists: Map<
    string,
    {
      artistName: string;
      pictureUrl: string | null;
      source: string | null;
      enrichedAt: Date | null;
      attemptedAt: Date | null;
    }
  >;
  jobs: Map<JobName, JobState>;
};

type MemoryTrack = MemoryStore["tracks"] extends Map<string, infer T> ? T : never;

function isPendingEnrichment(track: MemoryTrack): boolean {
  if (track.durationMs !== null && track.artworkUrl !== null) return false;
  if (track.attemptedAt === null) return true;
  return Date.now() - track.attemptedAt.getTime() >= ENRICHMENT_RETRY_AFTER_MS;
}

function identity(row: { trackKey: string; playedAt: Date }): string {
  return `${row.trackKey}@${row.playedAt.getTime()}`;
}

export function createMemoryStore(): MemoryStore {
  const scrobbles: ScrobbleRow[] = [];
  const seen = new Set<string>();
  const tracks: MemoryStore["tracks"] = new Map();
  const artists: MemoryStore["artists"] = new Map();
  const jobs = new Map<JobName, JobState>();

  return {
    scrobbles,
    tracks,
    artists,
    jobs,

    async insertScrobbles(rows) {
      let inserted = 0;
      for (const row of rows) {
        const key = identity(row);
        if (seen.has(key)) continue;
        seen.add(key);
        scrobbles.push(row);
        inserted += 1;
      }
      return inserted;
    },

    async upsertTrackSeeds(seeds) {
      let inserted = 0;
      for (const seed of seeds) {
        if (tracks.has(seed.trackKey)) continue;
        tracks.set(seed.trackKey, {
          ...seed,
          durationMs: null,
          artworkUrl: null,
          source: null,
          enrichedAt: null,
          attemptedAt: null,
        });
        inserted += 1;
      }
      return inserted;
    },

    async newestScrobbleAt() {
      if (scrobbles.length === 0) return null;
      return scrobbles.reduce((newest, row) =>
        row.playedAt > newest.playedAt ? row : newest,
      ).playedAt;
    },

    async countScrobbles() {
      return scrobbles.length;
    },

    async pendingEnrichment(limit): Promise<PendingTrack[]> {
      return [...tracks.values()]
        .filter(isPendingEnrichment)
        .sort((a, b) => a.trackKey.localeCompare(b.trackKey))
        .slice(0, limit)
        .map((track) => ({
          trackKey: track.trackKey,
          artistName: track.artistName,
          trackName: track.trackName,
          albumName: track.albumName,
        }));
    },

    async countPendingEnrichment() {
      return [...tracks.values()].filter(isPendingEnrichment).length;
    },

    async recordEnrichment(trackKey: string, result: TrackEnrichment) {
      const track = tracks.get(trackKey);
      if (!track) return;
      if (result.durationMs !== null) track.durationMs = result.durationMs;
      if (result.artworkUrl !== null) track.artworkUrl = result.artworkUrl;
      track.source = result.source;
      track.enrichedAt = new Date();
      track.attemptedAt = new Date();
    },

    async recordEnrichmentMiss(trackKey: string) {
      const track = tracks.get(trackKey);
      if (!track) return;
      track.attemptedAt = new Date();
    },

    async pendingArtists(limit: number) {
      const plays = new Map<string, { name: string; count: number }>();
      for (const scrobble of scrobbles) {
        const seen = plays.get(scrobble.artistKey);
        if (seen) seen.count += 1;
        else plays.set(scrobble.artistKey, { name: scrobble.artistName, count: 1 });
      }

      return [...plays.entries()]
        .filter(([artistKey]) => {
          const known = artists.get(artistKey);
          return !known || (!known.pictureUrl && !known.attemptedAt);
        })
        .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([artistKey, { name }]) => ({ artistKey, artistName: name }));
    },

    async countPendingArtists() {
      const keys = new Set(scrobbles.map((scrobble) => scrobble.artistKey));
      let total = 0;
      for (const artistKey of keys) {
        const known = artists.get(artistKey);
        if (!known || (!known.pictureUrl && !known.attemptedAt)) total += 1;
      }
      return total;
    },

    async recordArtistPicture(artistKey: string, picture: ArtistPicture) {
      const now = new Date();
      artists.set(artistKey, {
        artistName: picture.artistName,
        pictureUrl: picture.pictureUrl,
        source: picture.source,
        enrichedAt: now,
        attemptedAt: now,
      });
    },

    async recordArtistMiss(artistKey: string) {
      const known = artists.get(artistKey);
      if (known?.enrichedAt) return;
      artists.set(artistKey, {
        artistName: known?.artistName ?? artistKey,
        pictureUrl: known?.pictureUrl ?? null,
        source: known?.source ?? null,
        enrichedAt: null,
        attemptedAt: new Date(),
      });
    },

    async readJob(job: JobName) {
      return jobs.get(job) ?? null;
    },

    async writeJob(job: JobName, patch: JobPatch) {
      const previous = jobs.get(job) ?? {
        job,
        status: "idle",
        cursor: null,
        lastRunAt: null,
        lastError: null,
      };
      jobs.set(job, {
        job,
        status: patch.status ?? previous.status,
        cursor: patch.cursor !== undefined ? patch.cursor : previous.cursor,
        lastRunAt: patch.lastRunAt ?? previous.lastRunAt,
        lastError:
          patch.lastError !== undefined ? patch.lastError : previous.lastError,
      });
    },
  };
}
