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

export const siteSetting = pgTable("site_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

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
    source: text("source"),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("music_track_attempted_idx").on(table.attemptedAt)],
).enableRLS();

export const musicArtist = pgTable(
  "music_artist",
  {
    artistKey: text("artist_key").primaryKey(),
    artistName: text("artist_name").notNull(),
    pictureUrl: text("picture_url"),
    source: text("source"),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("music_artist_attempted_idx").on(table.attemptedAt)],
).enableRLS();

export const musicJobState = pgTable("music_job_state", {
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
