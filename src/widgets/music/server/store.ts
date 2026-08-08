import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  musicArtist,
  musicJobState,
  musicScrobble,
  musicTrack,
} from "@/lib/db/schema";

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
  insertScrobbles(rows: readonly ScrobbleRow[]): Promise<number>;
  upsertTrackSeeds(seeds: readonly TrackSeed[]): Promise<number>;
  newestScrobbleAt(): Promise<Date | null>;
  countScrobbles(): Promise<number>;
  pendingEnrichment(limit: number): Promise<PendingTrack[]>;
  countPendingEnrichment(): Promise<number>;
  recordEnrichment(trackKey: string, result: TrackEnrichment): Promise<void>;
  recordEnrichmentMiss(trackKey: string): Promise<void>;
  pendingArtists(limit: number): Promise<PendingArtist[]>;
  countPendingArtists(): Promise<number>;
  recordArtistPicture(artistKey: string, picture: ArtistPicture): Promise<void>;
  recordArtistMiss(artistKey: string): Promise<void>;
  readJob(job: JobName): Promise<JobState | null>;
  writeJob(job: JobName, patch: JobPatch): Promise<void>;
}

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
