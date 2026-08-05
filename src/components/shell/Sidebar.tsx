"use client";

import { GlassSurface } from "@/components/glass/GlassSurface";
import type { Registry } from "@/lib/registry/types";
import { PROFILE } from "@/lib/site/profile";
import { initialsFor } from "@/widgets/music/format";
import { useSite } from "./SiteContext";
import styles from "./shell.module.css";

/**
 * Widget navigation (R1).
 *
 * Built entirely by iterating the registry (R14) — the sidebar does not know
 * that About, Music or Settings exist, only that the registry has entries with
 * icons, titles and hotkeys.
 */
export function Sidebar({
  registry,
  openWidgetId,
  onOpen,
}: {
  registry: Registry;
  openWidgetId: string | null;
  onOpen: (id: string) => void;
}) {
  const { avatarUrl } = useSite();

  return (
    <GlassSurface
      as="aside"
      className={styles.sidebar}
      // Stable hook for the transition-name rule in globals.css — see the
      // note there on why it cannot live in the CSS module.
      data-shell="sidebar"
      aria-label="Widgets"
    >
      <div className={styles.profile}>
        <div className={styles.avatar}>
          {initialsFor(PROFILE.name)}
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- avoids the metered image optimizer
            <img className={styles.avatarImage} src={avatarUrl} alt="" />
          ) : null}
        </div>
        <div className={styles.profileMeta}>
          <div className={styles.profileName}>{PROFILE.name}</div>
          <div className={styles.profileHandle}>@{PROFILE.handle}</div>
        </div>
      </div>

      <nav className={styles.nav}>
        {registry.map((manifest) => {
          const Icon = manifest.icon;
          return (
            <button
              key={manifest.id}
              type="button"
              className={styles.navItem}
              aria-current={manifest.id === openWidgetId ? "true" : undefined}
              onClick={() => onOpen(manifest.id)}
            >
              <Icon className={styles.cardIcon} />
              <span className={styles.navLabel}>{manifest.title}</span>
              <kbd className={styles.hotkey}>{manifest.hotkey}</kbd>
            </button>
          );
        })}
      </nav>

      <p className={styles.sidebarFoot}>
        <span>Press a letter to open a widget.</span>
        <span>
          <kbd className={styles.hotkey}>esc</kbd> closes it.
        </span>
      </p>
    </GlassSurface>
  );
}
