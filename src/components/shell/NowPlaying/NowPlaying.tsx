"use client";

import { useEffect, useState } from "react";
import { sizedImageUrl } from "@/widgets/music/images/cdn";
import { formatRelativeTime, hueFor, initialsFor } from "@/widgets/music/format";
import type { NowPlaying as NowPlayingValue } from "@/widgets/music/server/now";
import styles from "./NowPlaying.module.css";

const POLL_INTERVAL_MS = 30_000;
const ART_PX = 26;

export function NowPlaying({ initial }: { initial: NowPlayingValue | null }) {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch("/api/music/now", {
          method: "POST",
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = await response.json();
        if (!cancelled) setValue(body.nowPlaying as NowPlayingValue | null);
      } catch {
      }
    }

    void poll();

    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!value) return null;

  return (
    <div
      className={styles.pulse}
      title={
        value.live
          ? `Playing now: ${value.track} by ${value.artist}`
          : `Last played: ${value.track} by ${value.artist}`
      }
      data-live={value.live ? "true" : "false"}
    >
      <div
        className={styles.art}
        style={{ "--art-hue": hueFor(value.track) } as React.CSSProperties}
        aria-hidden="true"
      >
        {initialsFor(value.track)}
        {value.artworkUrl ? (
          <img
            className={styles.artImage}
            src={sizedImageUrl(value.artworkUrl, ART_PX)}
            alt=""
          />
        ) : null}
      </div>

      {value.live ? <span className={styles.dot} aria-hidden="true" /> : null}

      <div className={styles.meta}>
        <div className={styles.track}>{value.track}</div>
        <div className={styles.artist}>{value.artist}</div>
      </div>

      {value.live ? (
        <span className={styles.when}>live</span>
      ) : value.playedAt ? (
        <span className={styles.when}>
          {formatRelativeTime(new Date(value.playedAt))}
        </span>
      ) : null}
    </div>
  );
}
