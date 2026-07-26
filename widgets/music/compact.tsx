"use client";

import { Artwork } from "./components/Artwork";
import { formatRelativeTime } from "./format";
import { useMusic } from "./useMusic";
import styles from "./music.module.css";

/**
 * Dashboard card.
 *
 * Leads with the listening rate rather than the lifetime scrobble count (R28),
 * then shows the three most recent plays so the card has something moving in it.
 */
export function MusicCompact() {
  const state = useMusic({ view: "recent", limit: 3 });

  if (state.status !== "ready") {
    return (
      <div className={styles.skeleton} aria-hidden="true">
        <div className={styles.skeletonRow} />
        <div className={styles.skeletonRow} />
      </div>
    );
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
