import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/*
 * Every table here calls `.enableRLS()` and defines no policy, which is the
 * intent rather than an oversight.
 *
 * Supabase exposes `public` through PostgREST to anyone holding the anon key,
 * and that key is public by design — it ships to browsers. RLS with no policy
 * denies PostgREST outright. It costs this application nothing because it does
 * not go through PostgREST at all: `lib/db/client.ts` connects as `postgres`,
 * which carries `rolbypassrls`, so these tables read and write exactly as
 * before. Owner-only access is enforced by the session cookie in `lib/auth`,
 * not here.
 *
 * RLS alone is not the whole guard — `anon` also held direct table grants, and
 * `ALTER DEFAULT PRIVILEGES` was re-granting them to every new table. Both are
 * revoked in migration 0003. `npm run db:audit` is what keeps it that way.
 */

/* -------------------------------------------------------------------------- */
/* site_* — owner-authored shell state. Read by the shell, About and Settings. */
/* -------------------------------------------------------------------------- */

/**
 * Key/value store for owner-authored site state: background id, glass opacity,
 * About copy, avatar object path. Value is JSON so a setting can be a string,
 * a number, or a small object without a migration.
 */
export const siteSetting = pgTable("site_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

/* -------------------------------------------------------------------------- */
/* music_* — the music widget's namespace. No other widget reads these (R15).  */
/* -------------------------------------------------------------------------- */

/**
 * One row per play.
 *
 * Raw artist/track/album strings are stored exactly as last.fm returned them
 * and are what every view displays. The `*_key` columns are the normalized
 * identity used for grouping and enrichment (KTD10) — scrobbles arrive from
 * whichever client submitted them, so casing, dashes, featuring credits and
 * remaster suffixes vary across plays of the same song.
 *
 * The unique index on (track_key, played_at) is what makes ingestion
 * idempotent (R22). It lives in the database rather than in application logic
 * so an overlapping poll cannot double-insert even under concurrency.
 */
export const musicScrobble = pgTable(
  "music_scrobble",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    trackKey: text("track_key").notNull(),
    artistKey: text("artist_key").notNull(),
    albumKey: text("album_key"),
    artistName: text("artist_name").notNull(),
    trackName: text("track_name").notNull(),
    albumName: text("album_name"),
    playedAt: timestamp("played_at", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("music_scrobble_identity_uq").on(table.trackKey, table.playedAt),
    index("music_scrobble_played_at_idx").on(table.playedAt),
    index("music_scrobble_artist_played_idx").on(table.artistKey, table.playedAt),
    index("music_scrobble_album_played_idx").on(table.albumKey, table.playedAt),
  ],
).enableRLS();

/**
 * One row per unique track, keyed by the same normalized identity.
 *
 * `durationMs` and `artworkUrl` are null until the enrichment sweep resolves
 * them. `attemptedAt` set with `enrichedAt` still null means both Deezer and
 * MusicBrainz missed — the sweep must not retry it forever (R23), and its
 * plays must be excluded from the minutes total rather than estimated (R24).
 */
export const musicTrack = pgTable(
  "music_track",
  {
    trackKey: text("track_key").primaryKey(),
    artistKey: text("artist_key").notNull(),
    artistName: text("artist_name").notNull(),
    trackName: text("track_name").notNull(),
    albumName: text("album_name"),
    durationMs: integer("duration_ms"),
    artworkUrl: text("artwork_url"),
    /** 'deezer' | 'musicbrainz' — null while unresolved. */
    source: text("source"),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("music_track_attempted_idx").on(table.attemptedAt)],
).enableRLS();

/**
 * One row per unique artist, keyed by the same normalized identity.
 *
 * Separate from `music_track` because an artist's picture is not a property of
 * any one recording — deriving it from a track's cover gives an album sleeve
 * where a portrait belongs. `attemptedAt` set with `enrichedAt` still null
 * means the lookup missed, and the sweep must not retry it forever.
 */
export const musicArtist = pgTable(
  "music_artist",
  {
    artistKey: text("artist_key").primaryKey(),
    artistName: text("artist_name").notNull(),
    pictureUrl: text("picture_url"),
    /** 'deezer' — null while unresolved. */
    source: text("source"),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("music_artist_attempted_idx").on(table.attemptedAt)],
).enableRLS();

/**
 * Cursor and heartbeat for the long-running jobs.
 *
 * Backfill and the enrichment sweep both exceed a serverless invocation
 * timeout, so each processes a bounded batch and advances `cursor` (KTD8).
 * `lastRunAt` doubles as the Supabase keepalive write (KTD5): the daily poll
 * updates this row on every run even when it ingests nothing, which resets the
 * 7-day pause-on-inactivity timer.
 */
export const musicJobState = pgTable("music_job_state", {
  /** 'backfill' | 'poll' | 'enrichment' */
  job: text("job").primaryKey(),
  status: text("status").notNull().default("idle"),
  cursor: jsonb("cursor"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

export type SiteSettingRow = typeof siteSetting.$inferSelect;
export type MusicScrobbleRow = typeof musicScrobble.$inferSelect;
export type MusicScrobbleInsert = typeof musicScrobble.$inferInsert;
export type MusicTrackRow = typeof musicTrack.$inferSelect;
export type MusicTrackInsert = typeof musicTrack.$inferInsert;
export type MusicArtistRow = typeof musicArtist.$inferSelect;
export type MusicArtistInsert = typeof musicArtist.$inferInsert;
export type MusicJobStateRow = typeof musicJobState.$inferSelect;
