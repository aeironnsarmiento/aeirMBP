import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  musicArtist,
  musicJobState,
  musicScrobble,
  musicTrack,
} from "@/lib/db/schema";

/**
 * The music widget's only door to the database (R15).
 *
 * Every table it touches is in the `music_*` namespace. Nothing outside this
 * module issues music queries, and nothing in it reads another widget's tables.
 *
 * It is an interface rather than a set of free functions so the ingestion,
 * backfill, poll and enrichment logic — the parts where a silent bug corrupts
 * data permanently — can be exercised against a store that enforces the same
 * uniqueness rules without a live Postgres.
 */

export type ScrobbleRow = {
  trackKey: string;
  artistKey: string;
  albumKey: string | null;
  artistName: string;
  trackName: string;
  albumName: string | null;
  playedAt: Date;
};

export type TrackSeed = {
  trackKey: string;
  artistKey: string;
  artistName: string;
  trackName: string;
  albumName: string | null;
};

export type TrackEnrichment = {
  durationMs: number | null;
  artworkUrl: string | null;
  source: string;
};

export type PendingTrack = {
  trackKey: string;
  artistName: string;
  trackName: string;
  albumName: string | null;
};

export type ArtistPicture = {
  artistName: string;
  pictureUrl: string;
  source: string;
};

export type PendingArtist = {
  artistKey: string;
  artistName: string;
};

/**
 * `catchup` is the ingest that rides along with the now-playing pulse. It gets
 * its own row rather than reusing `poll`, whose `lastRunAt` doubles as the
 * Supabase keepalive heartbeat — folding a request-time write into that row
 * would make "the scheduler ran" and "somebody loaded the page" the same fact.
 */
export type JobName = "backfill" | "poll" | "enrichment" | "catchup";

export type JobState = {
  job: JobName;
  status: string;
  cursor: unknown;
  lastRunAt: Date | null;
  lastError: string | null;
};

export type JobPatch = {
  status?: string;
  cursor?: unknown;
  lastRunAt?: Date;
  lastError?: string | null;
};

export interface MusicStore {
  /** Inserts rows, silently skipping any that already exist. Returns the number added. */
  insertScrobbles(rows: readonly ScrobbleRow[]): Promise<number>;
  /** Registers unique tracks so the enrichment sweep has a work list. */
  upsertTrackSeeds(seeds: readonly TrackSeed[]): Promise<number>;
  /** Newest stored play, or null when nothing has been ingested. */
  newestScrobbleAt(): Promise<Date | null>;
  countScrobbles(): Promise<number>;
  /** Tracks with neither resolved metadata nor a recorded attempt. */
  pendingEnrichment(limit: number): Promise<PendingTrack[]>;
  countPendingEnrichment(): Promise<number>;
  recordEnrichment(trackKey: string, result: TrackEnrichment): Promise<void>;
  /** Marks a track both sources missed, so the sweep stops retrying it. */
  recordEnrichmentMiss(trackKey: string): Promise<void>;
  /** Artists with no picture yet, most-played first so the visible list fills first. */
  pendingArtists(limit: number): Promise<PendingArtist[]>;
  countPendingArtists(): Promise<number>;
  recordArtistPicture(artistKey: string, picture: ArtistPicture): Promise<void>;
  /** Marks an artist the lookup missed, so the sweep stops retrying it. */
  recordArtistMiss(artistKey: string): Promise<void>;
  readJob(job: JobName): Promise<JobState | null>;
  writeJob(job: JobName, patch: JobPatch): Promise<void>;
}

/**
 * Artists still owed a portrait: never looked up, or looked up and left
 * without one. Shared by the work list and its count so the two can never
 * drift into disagreeing about what "pending" means.
 */
function artistNeedsPicture() {
  return or(
    isNull(musicArtist.artistKey),
    and(isNull(musicArtist.pictureUrl), isNull(musicArtist.attemptedAt)),
  );
}

export function createDrizzleStore(db = getDb()): MusicStore {
  return {
    async insertScrobbles(rows) {
      if (rows.length === 0) return 0;
      const inserted = await db
        .insert(musicScrobble)
        .values(rows as ScrobbleRow[])
        // The unique index on (track_key, played_at) is the idempotency
        // guarantee (R22) — an overlapping poll adds nothing.
        .onConflictDoNothing({
          target: [musicScrobble.trackKey, musicScrobble.playedAt],
        })
        .returning({ id: musicScrobble.id });
      return inserted.length;
    },

    async upsertTrackSeeds(seeds) {
      if (seeds.length === 0) return 0;
      const inserted = await db
        .insert(musicTrack)
        .values(seeds as TrackSeed[])
        .onConflictDoNothing({ target: musicTrack.trackKey })
        .returning({ trackKey: musicTrack.trackKey });
      return inserted.length;
    },

    async newestScrobbleAt() {
      const [row] = await db
        .select({ playedAt: musicScrobble.playedAt })
        .from(musicScrobble)
        .orderBy(desc(musicScrobble.playedAt))
        .limit(1);
      return row?.playedAt ?? null;
    },

    async countScrobbles() {
      const [row] = await db
        .select({ total: count() })
        .from(musicScrobble);
      return Number(row?.total ?? 0);
    },

    async pendingEnrichment(limit) {
      return db
        .select({
          trackKey: musicTrack.trackKey,
          artistName: musicTrack.artistName,
          trackName: musicTrack.trackName,
          albumName: musicTrack.albumName,
        })
        .from(musicTrack)
        .where(
          and(
            isNull(musicTrack.attemptedAt),
            or(isNull(musicTrack.durationMs), isNull(musicTrack.artworkUrl)),
          ),
        )
        .orderBy(musicTrack.trackKey)
        .limit(limit);
    },

    async countPendingEnrichment() {
      const [row] = await db
        .select({ total: count() })
        .from(musicTrack)
        .where(
          and(
            isNull(musicTrack.attemptedAt),
            or(isNull(musicTrack.durationMs), isNull(musicTrack.artworkUrl)),
          ),
        );
      return Number(row?.total ?? 0);
    },

    async recordEnrichment(trackKey, result) {
      await db
        .update(musicTrack)
        .set({
          durationMs: result.durationMs,
          artworkUrl: result.artworkUrl,
          source: result.source,
          enrichedAt: new Date(),
          attemptedAt: new Date(),
        })
        .where(eq(musicTrack.trackKey, trackKey));
    },

    async recordEnrichmentMiss(trackKey) {
      await db
        .update(musicTrack)
        .set({ attemptedAt: new Date() })
        .where(and(eq(musicTrack.trackKey, trackKey), isNull(musicTrack.enrichedAt)));
    },

    /*
     * Artists are not seeded anywhere, so the work list is derived from the
     * scrobbles themselves: every distinct artist that has no row yet, or has
     * one that was never attempted. Ordered by play count so the artists
     * actually visible in Top artists get a picture first.
     */
    async pendingArtists(limit) {
      return db
        .select({
          artistKey: musicScrobble.artistKey,
          artistName: sql<string>`mode() within group (order by ${musicScrobble.artistName})`,
        })
        .from(musicScrobble)
        .leftJoin(musicArtist, eq(musicArtist.artistKey, musicScrobble.artistKey))
        .where(artistNeedsPicture())
        .groupBy(musicScrobble.artistKey)
        .orderBy(sql`count(*) desc`, musicScrobble.artistKey)
        .limit(limit);
    },

    async countPendingArtists() {
      const [row] = await db
        .select({
          total: sql<number>`count(distinct ${musicScrobble.artistKey})`,
        })
        .from(musicScrobble)
        .leftJoin(musicArtist, eq(musicArtist.artistKey, musicScrobble.artistKey))
        .where(artistNeedsPicture());
      return Number(row?.total ?? 0);
    },

    async recordArtistPicture(artistKey, picture) {
      const now = new Date();
      await db
        .insert(musicArtist)
        .values({
          artistKey,
          artistName: picture.artistName,
          pictureUrl: picture.pictureUrl,
          source: picture.source,
          enrichedAt: now,
          attemptedAt: now,
        })
        .onConflictDoUpdate({
          target: musicArtist.artistKey,
          set: {
            pictureUrl: picture.pictureUrl,
            source: picture.source,
            enrichedAt: now,
            attemptedAt: now,
          },
        });
    },

    async recordArtistMiss(artistKey) {
      const now = new Date();
      await db
        .insert(musicArtist)
        .values({ artistKey, artistName: artistKey, attemptedAt: now })
        .onConflictDoUpdate({
          target: musicArtist.artistKey,
          set: { attemptedAt: now },
        });
    },

    async readJob(job) {
      const [row] = await db
        .select()
        .from(musicJobState)
        .where(eq(musicJobState.job, job))
        .limit(1);
      if (!row) return null;
      return {
        job: row.job as JobName,
        status: row.status,
        cursor: row.cursor,
        lastRunAt: row.lastRunAt,
        lastError: row.lastError,
      };
    },

    async writeJob(job, patch) {
      const now = new Date();
      await db
        .insert(musicJobState)
        .values({
          job,
          status: patch.status ?? "idle",
          cursor: patch.cursor ?? null,
          lastRunAt: patch.lastRunAt ?? null,
          lastError: patch.lastError ?? null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: musicJobState.job,
          set: {
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            ...(patch.cursor !== undefined ? { cursor: patch.cursor } : {}),
            ...(patch.lastRunAt !== undefined
              ? { lastRunAt: patch.lastRunAt }
              : {}),
            ...(patch.lastError !== undefined
              ? { lastError: patch.lastError }
              : {}),
            updatedAt: now,
          },
        });
    },
  };
}
