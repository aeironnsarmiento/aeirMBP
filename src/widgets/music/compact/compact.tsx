"use client";

import { Artwork } from "../components/Artwork/Artwork";
import { formatRelativeTime } from "../format";
import { MusicSkeleton } from "../MusicSkeleton/MusicSkeleton";
import { useMusic } from "../useMusic";
import styles from "./compact.module.css";

export function MusicCompact() {
  const state = useMusic({ view: "recent", limit: 5 });

  if (state.status !== "ready") {
    return <MusicSkeleton rows={2} />;
  }

  const { scrobblesThisWeek, perDayAverage } = state.data.summary;
  const plays = state.data.view === "recent" ? state.data.items : [];
  const now = new Date();

  return (
    <div>
      <div className={styles.compactRate}>
        <span className={styles.compactNumber}>
          {scrobblesThisWeek.toLocaleString()}
        </span>
        <span className={styles.compactUnit}>scrobbles this week</span>
      </div>
      <p className={styles.compactNote}>
        {perDayAverage} a day on average
      </p>

      {plays.length > 0 ? (
        <div className={styles.compactList}>
          {plays.map((play, index) => (
            <div key={`${play.playedAt}-${index}`} className={styles.compactRow}>
              <Artwork src={play.artworkUrl} title={play.trackName} size={28} />
              <div className={styles.compactMeta}>
                <div className={styles.compactTrack}>{play.trackName}</div>
                <div className={styles.compactArtist}>{play.artistName}</div>
              </div>
              <span className={styles.compactWhen}>
                {formatRelativeTime(new Date(play.playedAt), now)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.compactEmpty}>
          No scrobbles stored yet — run backfill from Settings.
        </p>
      )}
    </div>
  );
}
