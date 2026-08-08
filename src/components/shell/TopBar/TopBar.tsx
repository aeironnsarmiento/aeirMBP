"use client";

import { useEffect, useState } from "react";
import { GlassSurface } from "@/components/glass/GlassSurface";
import { ThemeToggle } from "@/components/glass/ThemeToggle/ThemeToggle";
import { recomputeTheme } from "@/components/glass/useTheme";
import { PROFILE } from "@/lib/site/profile";
import type { NowPlaying as NowPlayingValue } from "@/widgets/music/server/now";
import { NowPlaying } from "../NowPlaying/NowPlaying";
import { useSite } from "../SiteContext";
import { afterTransitions } from "../useOpenWidget";
import styles from "./TopBar.module.css";

export function TopBar({ nowPlaying }: { nowPlaying: NowPlayingValue | null }) {
  const { isOwner } = useSite();

  return (
    <GlassSurface as="header" className={styles.topbar}>
      <span className={styles.brand}>@{PROFILE.handle}</span>
      <NowPlaying initial={nowPlaying} />
      <div className={styles.spacer} />
      <Clock />
      <ThemeToggle />
      {isOwner ? <OwnerBadge /> : null}
    </GlassSurface>
  );
}

const TICK_MS = 15_000;

function Clock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      setTime(
        new Date().toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      recomputeTheme({ defer: afterTransitions });
    };

    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className={styles.clock} suppressHydrationWarning>
      {time ?? ""}
    </span>
  );
}

function OwnerBadge() {
  return (
    <span className={styles.iconButton} data-active="true" title="Signed in as owner">
      <svg
        width="13"
        height="13"
        viewBox="0 0 16 16"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3.2" y="7" width="9.6" height="6.6" rx="1.5" />
        <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" />
      </svg>
      <span className="sr-only">Signed in as owner</span>
    </span>
  );
}
