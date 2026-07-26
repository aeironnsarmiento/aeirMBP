"use client";

import { useState } from "react";
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
 * image optimization, and these are already-small remote covers that gain
 * nothing from being re-encoded.
 */
export function Artwork({ src, title, size = 44 }: ArtworkProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

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
          className={styles.image}
          src={src}
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
