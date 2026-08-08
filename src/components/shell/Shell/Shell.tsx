"use client";

import { useEffect, useMemo, useRef } from "react";
import { GlassSurface } from "@/components/glass/GlassSurface";
import { REGISTRY, visibleWidgets } from "@/lib/registry";
import { backgroundById, hasBackgroundPair } from "@/lib/theme/backgrounds";
import type { NowPlaying as NowPlayingValue } from "@/widgets/music/server/now";
import { Sidebar } from "../Sidebar/Sidebar";
import { SiteProvider, type SiteContextValue } from "../SiteContext";
import { TopBar } from "../TopBar/TopBar";
import { WidgetGrid } from "../WidgetGrid/WidgetGrid";
import { useOpenWidget } from "../useOpenWidget";
import styles from "./Shell.module.css";

export function Shell({
  site,
  nowPlaying,
}: {
  site: SiteContextValue;
  nowPlaying: NowPlayingValue | null;
}) {
  const registry = useMemo(
    () => visibleWidgets(REGISTRY, site.isOwner),
    [site.isOwner],
  );

  const store = useOpenWidget(registry);

  const single = backgroundById(
    site.settings.backgroundId,
    site.backgrounds.single.customUrl,
  );
  const video =
    !hasBackgroundPair(site.backgrounds) && single.kind === "video"
      ? single
      : null;

  const backgroundVideo = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = backgroundVideo.current;
    if (!element) return;

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (query.matches) element.pause();
      else void element.play().catch(() => {});
    };

    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [video?.src]);

  return (
    <SiteProvider value={site}>
      {video ? (
        <video
          ref={backgroundVideo}
          className={styles.background}
          src={video.src}
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
          tabIndex={-1}
        />
      ) : (

        <div className={styles.background} aria-hidden="true" />
      )}
      <div className={styles.viewport}>
        <GlassSurface
          as="div"
          className={styles.shell}
          data-shell="frame"
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
