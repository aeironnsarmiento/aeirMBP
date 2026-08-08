"use client";

import { useSite } from "@/components/shell/SiteContext";
import { PROFILE } from "@/lib/site/profile";
import { AboutAvatar } from "../AboutAvatar/AboutAvatar";
import styles from "./compact.module.css";

export function AboutCompact() {
  const { avatarUrl } = useSite();

  return (
    <div className={styles.compact}>
      <AboutAvatar url={avatarUrl} name={PROFILE.name} size="compact" decorative />
      <div>
        <div className={styles.handle}>@{PROFILE.handle}</div>
        <p className={styles.compactCopy}>{PROFILE.aboutCopy}</p>
      </div>
    </div>
  );
}
