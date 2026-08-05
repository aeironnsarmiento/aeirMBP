"use client";

import { useEffect, useState } from "react";
import { GlassSurface } from "@/components/glass/GlassSurface";
import { ThemeToggle } from "@/components/glass/ThemeToggle";
import { recomputeTheme } from "@/components/glass/useTheme";
import { PROFILE } from "@/lib/site/profile";
import type { NowPlaying as NowPlayingValue } from "@/widgets/music/server/now";
import { NowPlaying } from "./NowPlaying";
import { useSite } from "./SiteContext";
import { afterTransitions } from "./useOpenWidget";
import styles from "./shell.module.css";

export function TopBar({ nowPlaying }: { nowPlaying: NowPlayingValue | null }) {
  const { isOwner } = useSite();

  return (
    <GlassSurface as="header" className={styles.topbar}>
      <span className={styles.brand}>@{PROFILE.handle}</span>
      <NowPlaying initial={nowPlaying} />
      <div className={styles.spacer} />
      <Clock />
      <ThemeToggle />
      {/* No sign-in affordance for a visitor or a signed-out owner (R1); the
          way back in is docs/owner-sign-in.md. Sign-out lives in the Settings
          widget, which a visitor's registry does not contain. */}
      {isOwner ? <OwnerBadge /> : null}
    </GlassSurface>
  );
}

/** One wall-clock read drives both the clock and the appearance schedule. */
const TICK_MS = 15_000;

function Clock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    // Rendered client-only: the server has no idea what timezone the visitor
    // is in, and guessing produces a hydration mismatch on every load.
    const tick = () => {
      setTime(
        new Date().toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );

      // The switchover rides this interval (R15, KTD3): already a wall-clock
      // recompute on a fixed cadence, which is what a schedule needs and what
      // an armed timer is not. The wallpaper follows by cascade.
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
