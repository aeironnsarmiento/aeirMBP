"use client";

import { useSite } from "@/components/shell/SiteContext";
import { backgroundById } from "@/lib/theme/backgrounds";
import styles from "./settings.module.css";

export function SettingsCompact() {
  const { settings } = useSite();

  return (
    <div className={styles.compactList}>
      <div className={styles.compactRow}>
        <span>Background</span>
        <span className={styles.compactValue}>
          {backgroundById(settings.backgroundId).label}
        </span>
      </div>
      <div className={styles.compactRow}>
        <span>Frame opacity</span>
        <span className={styles.compactValue}>
          {settings.frameOpacity.toFixed(2)}
        </span>
      </div>
      <div className={styles.compactRow}>
        <span>Pane opacity</span>
        <span className={styles.compactValue}>
          {settings.paneOpacity.toFixed(2)}
        </span>
      </div>
      <div className={styles.compactRow}>
        <span>Avatar</span>
        <span className={styles.compactValue}>
          {settings.avatarPath ? "set" : "none"}
        </span>
      </div>
    </div>
  );
}
