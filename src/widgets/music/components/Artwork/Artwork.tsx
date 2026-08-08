"use client";

import { useCallback, useState } from "react";
import { sizedImageUrl } from "@/widgets/music/images/cdn";
import { hueFor, initialsFor } from "../../format";
import styles from "./Artwork.module.css";

export type ArtworkProps = {
  src: string | null;
  title: string;
  size?: number;
};

export function Artwork({ src, title, size = 44 }: ArtworkProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
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
