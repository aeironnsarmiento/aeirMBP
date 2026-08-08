"use client";

import { GlassSurface } from "@/components/glass/GlassSurface";
import type { Registry } from "@/lib/registry/types";
import { PROFILE } from "@/lib/site/profile";
import { initialsFor } from "@/widgets/music/format";
import { useSite } from "../SiteContext";
import { WidgetHotkey } from "../WidgetHotkey/WidgetHotkey";
import styles from "./Sidebar.module.css";

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
      data-shell="sidebar"
      aria-label="Widgets"
    >
      <div className={styles.profile}>
        <div className={styles.avatar}>
          {initialsFor(PROFILE.name)}
          {avatarUrl ? (
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
              <WidgetHotkey>{manifest.hotkey}</WidgetHotkey>
            </button>
          );
        })}
      </nav>

      <p className={styles.sidebarFoot}>
        <span>Press a letter to open a widget.</span>
        <span>
          <WidgetHotkey>esc</WidgetHotkey> closes it.
        </span>
      </p>
    </GlassSurface>
  );
}
