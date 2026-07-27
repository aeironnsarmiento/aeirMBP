"use client";

import { useCallback, useState } from "react";
import { sizedImageUrl } from "@/lib/images/cdn";
import { hueFor, initialsFor } from "../format";
import styles from "./Artwork.module.css";

export type ArtworkProps = {
  src: string | null;
  /** Used for the alt text and to derive the fallback treatment. */
  title: string;
  size?: number;
};

/**
 * Cover art with a deliberate fallback (AE4).
 *
 * A track neither Deezer nor MusicBrainz could match still renders as a
 * coloured tile with initials rather than a broken image or an empty box. The
 * hue is derived from the title, so the same track always looks the same.
 *
 * A plain `img` rather than next/image on purpose: Vercel's Hobby plan meters
 * image optimization, and the provider already publishes every size we need —
 * `sizedImageUrl` picks the right one from the URL, so there is nothing for an
 * optimizer to do that a string replacement has not already done.
 */
export function Artwork({ src, title, size = 44 }: ArtworkProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  /*
   * `onLoad` alone drops cached images. A cover already in the browser cache —
   * the common case when switching sub-views, since the same covers recur —
   * can finish decoding before React attaches the handler, and the event has
   * then already fired. The tile would sit on its initials forever with a
   * fully-decoded image behind it.
   *
   * The ref runs on attach, so it catches exactly that case: an element whose
   * `complete` is already true, with a real `naturalWidth` to distinguish a
   * decoded image from a failed one.
   */
  const captureLoaded = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) setLoaded(true);
  }, []);

  const showImage = src !== null && !failed;

  return (
    <div
      className={styles.artwork}
      style={
        {
          width: size,
          height: size,
          "--art-hue": hueFor(title),
        } as React.CSSProperties
      }
      aria-hidden={showImage ? undefined : "true"}
    >
      {initialsFor(title)}
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- see the note above
        <img
          ref={captureLoaded}
          className={styles.image}
          src={sizedImageUrl(src, size)}
          alt={title}
          loading="lazy"
          decoding="async"
          data-loaded={loaded ? "true" : "false"}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
    </div>
  );
}
