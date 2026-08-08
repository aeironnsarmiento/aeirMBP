import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/lib/db/schema";
import { musicScrobble, musicTrack } from "@/lib/db/schema";
import type { MusicDb } from "@/widgets/music/queries/aggregations";
import { albumKey, normalizeArtist, trackKey } from "@/widgets/music/server/normalize";

export async function createTestDb(): Promise<{
  db: MusicDb;
  close: () => Promise<void>;
}> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });

  return {
    db: db as unknown as MusicDb,
    close: () => client.close(),
  };
}

export type SeedPlay = {
  artist: string;
  track: string;
  album?: string | null;
  playedAt: Date;
};

export async function seedScrobbles(db: MusicDb, plays: readonly SeedPlay[]) {
  if (plays.length === 0) return;

  await db.insert(musicScrobble).values(
    plays.map((play) => ({
      trackKey: trackKey(play.artist, play.track),
      artistKey: normalizeArtist(play.artist),
      albumKey: albumKey(play.artist, play.album ?? null),
      artistName: play.artist,
      trackName: play.track,
      albumName: play.album ?? null,
      playedAt: play.playedAt,
    })),
  );
}

export type SeedTrack = {
  artist: string;
  track: string;
  album?: string | null;
  durationMs?: number | null;
  artworkUrl?: string | null;
};

export async function seedTracks(db: MusicDb, tracks: readonly SeedTrack[]) {
  if (tracks.length === 0) return;

  await db
    .insert(musicTrack)
    .values(
      tracks.map((entry) => ({
        trackKey: trackKey(entry.artist, entry.track),
        artistKey: normalizeArtist(entry.artist),
        artistName: entry.artist,
        trackName: entry.track,
        albumName: entry.album ?? null,
        durationMs: entry.durationMs ?? null,
        artworkUrl: entry.artworkUrl ?? null,
        enrichedAt: entry.durationMs || entry.artworkUrl ? new Date() : null,
        attemptedAt: new Date(),
      })),
    )
    .onConflictDoNothing();
}
