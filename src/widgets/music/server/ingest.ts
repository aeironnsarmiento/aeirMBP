import type { LastfmPlay } from "../lastfm/client";
import { albumKey, normalizeArtist, trackKey } from "./normalize";
import type { MusicStore, ScrobbleRow, TrackSeed } from "./store";

export type IngestResult = {
  inserted: number;
  considered: number;
  skippedNowPlaying: number;
  skippedDuplicates: number;
  newTracks: number;
};

export type ScrobbleBatch = {
  rows: ScrobbleRow[];
  skippedNowPlaying: number;
  skippedDuplicates: number;
};

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
