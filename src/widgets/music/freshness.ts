"use client";

import { useSyncExternalStore } from "react";

/**
 * A counter that moves whenever new plays land in the stored history. The
 * now-playing pulse is what writes them, but the music widgets read from the
 * database, so without this they would keep showing whatever was stored when
 * they mounted — and the compact card and the expanded view, mounted at
 * different moments, would disagree with each other.
 */
let version = 0;
const listeners = new Set<() => void>();

export function markMusicStale(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const read = () => version;

export function useMusicVersion(): number {
  return useSyncExternalStore(subscribe, read, () => 0);
}
