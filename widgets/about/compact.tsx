"use client";

import { useSite } from "@/components/shell/SiteContext";
import { initialsFor } from "@/widgets/music/format";
import styles from "./about.module.css";

export function AboutCompact() {
  const { settings, avatarUrl } = useSite();

  return (
    <div className={styles.compact}>
      <div className={styles.compactAvatar}>
        {initialsFor(settings.name || "?")}
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- avoids the metered image optimizer
          <img className={styles.avatarImage} src={avatarUrl} alt="" />
        ) : null}
      </div>
      <div>
        <div className={styles.handle}>@{settings.handle || "unset"}</div>
        <p className={styles.compactCopy}>
          {settings.aboutCopy || "No bio written yet."}
        </p>
      </div>
    </div>
  );
}
