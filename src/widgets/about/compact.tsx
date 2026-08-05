"use client";

import { useSite } from "@/components/shell/SiteContext";
import { PROFILE } from "@/lib/site/profile";
import { initialsFor } from "@/widgets/music/format";
import styles from "./about.module.css";

export function AboutCompact() {
  const { avatarUrl } = useSite();

  return (
    <div className={styles.compact}>
      <div className={styles.compactAvatar}>
        {initialsFor(PROFILE.name)}
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- avoids the metered image optimizer
          <img className={styles.avatarImage} src={avatarUrl} alt="" />
        ) : null}
      </div>
      <div>
        <div className={styles.handle}>@{PROFILE.handle}</div>
        <p className={styles.compactCopy}>{PROFILE.aboutCopy}</p>
      </div>
    </div>
  );
}
