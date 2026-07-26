"use client";

import { useState } from "react";
import { GlassSurface } from "@/components/glass/GlassSurface";
import type { WidgetExpandedProps } from "@/lib/registry/types";
import { Artwork } from "./components/Artwork";
import {
  formatDuration,
  formatListeningTime,
  formatPlays,
  formatRelativeTime,
} from "./format";
import type { MusicSummary } from "./queries/aggregations";
import { RANGE_LABELS, TIME_RANGES, type TimeRange } from "./queries/ranges";
import type { MusicResponse } from "./useMusic";
import { useMusic } from "./useMusic";
import styles from "./music.module.css";

/** Recently played has no range: it is a feed, not a tally. */
const RANGED_VIEWS = new Set(["artists", "albums", "tracks"]);

export function MusicExpanded({
  subView,
  params,
  setParam,
}: WidgetExpandedProps) {
  const view = subView ?? "recent";
  const range = (params.range ?? "week") as TimeRange;
  const ranged = RANGED_VIEWS.has(view);

  const state = useMusic({
    view,
    range: ranged ? range : undefined,
    limit: view === "recent" ? 60 : 40,
  });

  // The totals outlive a view switch — see the note in useMusic.
  const summary = state.summary;
  const [statsOpen, setStatsOpen] = useState(true);

  return (
    <div>
      {summary ? (
        <>
          <button
            type="button"
            className={styles.statsToggle}
            aria-expanded={statsOpen}
            aria-controls="music-stats"
            onClick={() => setStatsOpen((open) => !open)}
          >
            <span>{summary.scrobblesThisWeek.toLocaleString()} scrobbles this week</span>
            <svg
              className={styles.statsCaret}
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 4.5L6 7.5l3-3" />
            </svg>
          </button>
          <div id="music-stats" hidden={!statsOpen}>
            <Summary data={summary} />
          </div>
        </>
      ) : null}

      {ranged ? (
        <div className={styles.controls}>
          <span className={styles.controlLabel}>Ranked by plays</span>
          <div className={styles.ranges} role="group" aria-label="Time range">
            {TIME_RANGES.map((option) => (
              <button
                key={option}
                type="button"
                className={styles.range}
                aria-pressed={option === range}
                onClick={() => setParam("range", option)}
              >
                {RANGE_LABELS[option]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {state.status === "loading" ? <Skeleton /> : null}

      {state.status === "error" ? (
        <p className={styles.error}>Could not load this view. {state.message}</p>
      ) : null}

      {state.status === "ready" ? <Body data={state.data} /> : null}
    </div>
  );
}

function Summary({ data }: { data: MusicSummary }) {
  const {
    scrobblesThisWeek,
    perDayAverage,
    listeningMinutes,
    playsWithoutDuration,
    uniqueArtists,
    totalScrobbles,
  } = data;

  return (
    <div className={styles.summary}>
      {/* Rate leads. "7,338 scrobbles all time" undersells an account this
          young; "570 this week" is both accurate and the more striking figure. */}
      <GlassSurface tone="well" className={styles.stat}>
        <div className={styles.statValue}>
          {scrobblesThisWeek.toLocaleString()}
        </div>
        <div className={styles.statLabel}>Scrobbles this week</div>
      </GlassSurface>

      <GlassSurface tone="well" className={styles.stat}>
        <div className={styles.statValue}>{perDayAverage}</div>
        <div className={styles.statLabel}>Per day</div>
      </GlassSurface>

      <GlassSurface tone="well" className={styles.stat}>
        <div className={styles.statValue}>
          {formatListeningTime(listeningMinutes)}
        </div>
        <div className={styles.statLabel}>Listening time</div>
        {playsWithoutDuration > 0 ? (
          // Stated rather than hidden: the total is defensible precisely
          // because unmatched tracks are excluded, not estimated (R24).
          <div className={styles.statNote}>
            {playsWithoutDuration.toLocaleString()} plays excluded, no duration
          </div>
        ) : null}
      </GlassSurface>

      <GlassSurface tone="well" className={styles.stat}>
        <div className={styles.statValue}>{uniqueArtists.toLocaleString()}</div>
        <div className={styles.statLabel}>Artists</div>
        <div className={styles.statNote}>
          {totalScrobbles.toLocaleString()} scrobbles all time
        </div>
      </GlassSurface>
    </div>
  );
}

function Skeleton() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className={styles.skeletonRow} />
      ))}
    </div>
  );
}

function Empty({ view }: { view: string }) {
  return (
    <div className={styles.empty}>
      <p>Nothing here yet.</p>
      <p className={styles.emptyHint}>
        {view === "recent"
          ? "Scrobbles appear once the history has been imported."
          : "No plays in this range — try a wider one."}
      </p>
    </div>
  );
}

function Body({ data }: { data: MusicResponse }) {
  if (data.view === "recent") {
    if (data.items.length === 0) return <Empty view="recent" />;
    const now = new Date();

    return (
      <div className={styles.list}>
        {data.items.map((play, index) => (
          <div
            key={`${play.playedAt}-${index}`}
            className={styles.row}
            style={{ "--share": 0 } as React.CSSProperties}
          >
            <Artwork src={play.artworkUrl} title={play.trackName} />
            <div className={styles.meta}>
              <div className={styles.primary}>{play.trackName}</div>
              <div className={styles.secondary}>
                {play.artistName}
                {play.albumName ? ` · ${play.albumName}` : ""}
              </div>
            </div>
            <div className={styles.trailing}>
              <time dateTime={new Date(play.playedAt).toISOString()}>
                {formatRelativeTime(new Date(play.playedAt), now)}
              </time>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const top = data.items[0]?.plays ?? 1;
  if (data.items.length === 0) return <Empty view={data.view} />;

  return (
    <div className={styles.list}>
      {data.items.map((item, index) => {
        const share = top > 0 ? item.plays / top : 0;
        const key =
          "artistKey" in item
            ? item.artistKey
            : "albumKey" in item
              ? item.albumKey
              : item.trackKey;

        const title = "trackName" in item ? item.trackName : "albumName" in item ? item.albumName : item.artistName;
        const artwork = "artworkUrl" in item ? item.artworkUrl : null;

        return (
          <div
            key={key}
            className={styles.row}
            style={{ "--share": share } as React.CSSProperties}
          >
            <span className={styles.rank}>{index + 1}</span>
            <Artwork src={artwork} title={title ?? item.artistName} />
            <div className={styles.meta}>
              <div className={styles.primary}>{title}</div>
              {data.view !== "artists" ? (
                <div className={styles.secondary}>{item.artistName}</div>
              ) : null}
            </div>
            <div className={styles.trailing}>
              {"durationMs" in item ? (
                <span className={styles.duration}>
                  {formatDuration(item.durationMs)}
                </span>
              ) : null}
              <span>{formatPlays(item.plays)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
