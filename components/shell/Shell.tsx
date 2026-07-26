"use client";

import { useMemo } from "react";
import { REGISTRY, visibleWidgets } from "@/lib/registry";
import { backgroundById } from "@/lib/theme/backgrounds";
import type { NowPlaying as NowPlayingValue } from "@/widgets/music/server/now";
import { ModalHost } from "./ModalHost";
import { Sidebar } from "./Sidebar";
import { SiteProvider, type SiteContextValue } from "./SiteContext";
import { TopBar } from "./TopBar";
import { WidgetGrid } from "./WidgetGrid";
import { useOpenWidget } from "./useOpenWidget";
import styles from "./shell.module.css";

/**
 * The persistent desktop (R1).
 *
 * Never unmounts while a widget expands — the modal is a sibling layer over
 * the shell, not a replacement for it.
 */
export function Shell({
  site,
  nowPlaying,
}: {
  site: SiteContextValue;
  nowPlaying: NowPlayingValue | null;
}) {
  // Admin-only entries are filtered out of the data for a visitor, so no
  // rendering path below can reach Settings (R16, AE2).
  const registry = useMemo(
    () => visibleWidgets(REGISTRY, site.isOwner),
    [site.isOwner],
  );

  const store = useOpenWidget(registry);
  const background = backgroundById(site.settings.backgroundId);

  return (
    <SiteProvider value={site}>
      <div
        className={styles.background}
        style={{ backgroundImage: `url(${background.src})` }}
        aria-hidden="true"
      />
      <div className={styles.shell}>
        <TopBar nowPlaying={nowPlaying} />
        <Sidebar
          registry={registry}
          openWidgetId={store.state.widgetId}
          onOpen={store.open}
        />
        <WidgetGrid registry={registry} onOpen={store.open} />
      </div>
      <ModalHost registry={registry} store={store} />
    </SiteProvider>
  );
}
