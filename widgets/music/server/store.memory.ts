import type {
  JobName,
  JobPatch,
  JobState,
  MusicStore,
  PendingTrack,
  ScrobbleRow,
  TrackEnrichment,
  TrackSeed,
} from "./store";

/**
 * In-memory MusicStore that enforces the same uniqueness rules as the schema.
 *
 * A test double, used only by the ingestion, backfill, poll and enrichment
 * tests. Those are the paths where a bug corrupts data permanently and no
 * amount of manual checking would surface it, so they are exercised against a
 * store that actually rejects a duplicate (track_key, played_at) rather than
 * against a mock that records calls.
 */
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
  jobs: Map<JobName, JobState>;
};

function identity(row: { trackKey: string; playedAt: Date }): string {
  return `${row.trackKey}@${row.playedAt.getTime()}`;
}

export function createMemoryStore(): MemoryStore {
  const scrobbles: ScrobbleRow[] = [];
  const seen = new Set<string>();
  const tracks: MemoryStore["tracks"] = new Map();
  const jobs = new Map<JobName, JobState>();

  return {
    scrobbles,
    tracks,
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
        .filter(
          (track) =>
            track.attemptedAt === null &&
            (track.durationMs === null || track.artworkUrl === null),
        )
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
      return [...tracks.values()].filter(
        (track) =>
          track.attemptedAt === null &&
          (track.durationMs === null || track.artworkUrl === null),
      ).length;
    },

    async recordEnrichment(trackKey: string, result: TrackEnrichment) {
      const track = tracks.get(trackKey);
      if (!track) return;
      track.durationMs = result.durationMs;
      track.artworkUrl = result.artworkUrl;
      track.source = result.source;
      track.enrichedAt = new Date();
      track.attemptedAt = new Date();
    },

    async recordEnrichmentMiss(trackKey: string) {
      const track = tracks.get(trackKey);
      if (!track || track.enrichedAt) return;
      track.attemptedAt = new Date();
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
