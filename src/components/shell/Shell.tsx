"use client";

import { useEffect, useMemo, useRef } from "react";
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

  /*
   * Reduced motion stops the wallpaper on its first frame (R9).
   *
   * `autoplay` is a playback instruction, not a style, so the media query
   * cannot reach it — this is the one place motion policy needs JavaScript.
   * Pausing rather than swapping the source keeps a single element and a single
   * fetch, and the still frame is the one the video already decoded.
   */
  const backgroundVideo = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = backgroundVideo.current;
    if (!video) return;

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (query.matches) video.pause();
      else void video.play().catch(() => {});
    };

    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [background.src]);

  return (
    <SiteProvider value={site}>
      {/*
        A video wallpaper is an element, not a background-image. It is also the
        only shape an animated background is allowed to take: an animated GIF
        repaints the whole viewport every frame, and the frame below carries the
        site's one backdrop filter, so each repaint re-blurs the screen (R3).
        Uploads are re-encoded to video before they are stored.
      */}
      {background.kind === "video" ? (
        <video
          ref={backgroundVideo}
          className={styles.background}
          src={background.src}
          autoPlay
          loop
          muted
          playsInline
          // Decoding it is the point; announcing it is not.
          aria-hidden="true"
          tabIndex={-1}
        />
      ) : (
        <div
          className={styles.background}
          style={{ backgroundImage: `url(${background.src})` }}
          aria-hidden="true"
        />
      )}
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
