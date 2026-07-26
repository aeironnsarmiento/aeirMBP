"use client";

import { useMemo } from "react";
import { GlassSurface } from "@/components/glass/GlassSurface";
import { REGISTRY, visibleWidgets } from "@/lib/registry";
import { backgroundById } from "@/lib/theme/backgrounds";
import type { NowPlaying as NowPlayingValue } from "@/widgets/music/server/now";
import { Sidebar } from "./Sidebar";
import { SiteProvider, type SiteContextValue } from "./SiteContext";
import { TopBar } from "./TopBar";
import { WidgetGrid } from "./WidgetGrid";
import { useOpenWidget } from "./useOpenWidget";
import styles from "./shell.module.css";

/**
 * The persistent desktop (R1).
 *
 * Never unmounts while a widget expands. A widget grows inside the frame and
 * its siblings compress beside it, so the shell is not covered, replaced, or
 * layered over — there is one surface and it reshapes (R4).
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
  const background = backgroundById(
    site.settings.backgroundId,
    site.backgroundUrl,
  );

  return (
    <SiteProvider value={site}>
      <div
        className={styles.background}
        style={{ backgroundImage: `url(${background.src})` }}
        aria-hidden="true"
      />
      {/*
        One frame holds the whole desktop (R1). It is the only surface that
        blurs: everything below it counts as depth 2, so GlassSurface writes
        data-blur="off" and the material falls back to tint (R3). The dropped
        shadow on every card (R2) comes from the same rule.
      */}
      <div className={styles.viewport}>
        <GlassSurface
          as="div"
          className={styles.shell}
          radius="var(--radius-xl)"
        >
          <TopBar nowPlaying={nowPlaying} />
          <Sidebar
            registry={registry}
            openWidgetId={store.state.widgetId}
            onOpen={store.open}
          />
          <WidgetGrid registry={registry} store={store} />
        </GlassSurface>
      </div>
    </SiteProvider>
  );
}
