import type { LastfmPlay } from "../lastfm/client";
import { albumKey, normalizeArtist, trackKey } from "./normalize";
import type { MusicStore, ScrobbleRow, TrackSeed } from "./store";

export type IngestResult = {
  /** Rows the store actually added. Zero for a fully overlapping window (AE3). */
  inserted: number;
  /** Plays offered to the store after in-batch deduplication. */
  considered: number;
  /** Currently-playing entries dropped before they could be persisted. */
  skippedNowPlaying: number;
  /** Duplicates removed within this batch, before touching the store. */
  skippedDuplicates: number;
  /** Unique tracks newly registered for the enrichment sweep. */
  newTracks: number;
};

export type ScrobbleBatch = {
  rows: ScrobbleRow[];
  skippedNowPlaying: number;
  skippedDuplicates: number;
};

/**
 * Turns last.fm plays into storable rows.
 *
 * Two things happen here that no later stage can undo:
 *
 * 1. The currently-playing entry is dropped. last.fm returns it with no
 *    timestamp; persisting it would invent a scrobble at ingest time and, once
 *    the song actually finished, produce a second row for the same play.
 * 2. Raw display strings are copied through untouched. Normalization only ever
 *    populates the `*_key` columns (KTD10).
 */
export function toScrobbleRows(plays: readonly LastfmPlay[]): ScrobbleBatch {
  const rows: ScrobbleRow[] = [];
  const seen = new Set<string>();
  let skippedNowPlaying = 0;
  let skippedDuplicates = 0;

  for (const play of plays) {
    if (play.nowPlaying || play.playedAt === null) {
      skippedNowPlaying += 1;
      continue;
    }

    const key = trackKey(play.artist, play.track);
    const identity = `${key}@${play.playedAt.getTime()}`;
    if (seen.has(identity)) {
      // last.fm repeats a play across a page boundary when a new scrobble
      // lands mid-pagination. Collapsing here keeps the reported counts honest.
      skippedDuplicates += 1;
      continue;
    }
    seen.add(identity);

    rows.push({
      trackKey: key,
      artistKey: normalizeArtist(play.artist),
      albumKey: albumKey(play.artist, play.album),
      artistName: play.artist,
      trackName: play.track,
      albumName: play.album,
      playedAt: play.playedAt,
    });
  }

  return { rows, skippedNowPlaying, skippedDuplicates };
}

/** The unique tracks in a batch, in first-seen order. */
export function toTrackSeeds(rows: readonly ScrobbleRow[]): TrackSeed[] {
  const seeds = new Map<string, TrackSeed>();
  for (const row of rows) {
    if (seeds.has(row.trackKey)) continue;
    seeds.set(row.trackKey, {
      trackKey: row.trackKey,
      artistKey: row.artistKey,
      artistName: row.artistName,
      trackName: row.trackName,
      albumName: row.albumName,
    });
  }
  return [...seeds.values()];
}

/**
 * Persists a batch of plays.
 *
 * Idempotent (R22): the store's unique index on (track_key, played_at) means a
 * poll covering an already-ingested window inserts nothing, and re-running it
 * is free.
 */
export async function ingestPlays(
  store: MusicStore,
  plays: readonly LastfmPlay[],
): Promise<IngestResult> {
  const { rows, skippedNowPlaying, skippedDuplicates } = toScrobbleRows(plays);

  const inserted = await store.insertScrobbles(rows);
  const newTracks = await store.upsertTrackSeeds(toTrackSeeds(rows));

  return {
    inserted,
    considered: rows.length,
    skippedNowPlaying,
    skippedDuplicates,
    newTracks,
  };
}
