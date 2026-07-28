"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GlassSurface } from "@/components/glass/GlassSurface";
import { ThemeToggle } from "@/components/glass/ThemeToggle";
import type { NowPlaying as NowPlayingValue } from "@/widgets/music/server/now";
import { NowPlaying } from "./NowPlaying";
import { useSite } from "./SiteContext";
import styles from "./shell.module.css";

export function TopBar({ nowPlaying }: { nowPlaying: NowPlayingValue | null }) {
  const { settings, isOwner } = useSite();

  return (
    <GlassSurface as="header" className={styles.topbar}>
      <span className={styles.brand}>@{settings.handle}</span>
      <NowPlaying initial={nowPlaying} />
      <div className={styles.spacer} />
      <Clock />
      <ThemeToggle />
      {isOwner ? <OwnerBadge /> : <SignIn />}
    </GlassSurface>
  );
}

function Clock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    // Rendered client-only: the server has no idea what timezone the visitor
    // is in, and guessing produces a hydration mismatch on every load.
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    tick();
    const timer = setInterval(tick, 15_000);
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

/**
 * Owner sign-in.
 *
 * One secret, one field, no account system (KTD9). The value is posted
 * straight to the auth route and never held anywhere else — a failure clears
 * the field rather than reporting which part was wrong.
 */
function SignIn() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [failed, setFailed] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailed(false);

    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
    });

    setSecret("");

    if (!response.ok) {
      setFailed(true);
      return;
    }

    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        className={styles.iconButton}
        onClick={() => setOpen(true)}
        aria-label="Owner sign in"
        title="Owner sign in"
      >
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
          <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0" />
        </svg>
      </button>
    );
  }

  return (
    <form className={styles.signIn} onSubmit={submit}>
      <input
        className={styles.signInInput}
        type="password"
        value={secret}
        autoFocus
        placeholder={failed ? "Not recognised" : "Owner secret"}
        aria-label="Owner secret"
        autoComplete="current-password"
        onChange={(event) => setSecret(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      <button type="submit" className={styles.iconButton} aria-label="Sign in">
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 8.4L6.4 12 13 4.6" />
        </svg>
      </button>
    </form>
  );
}
