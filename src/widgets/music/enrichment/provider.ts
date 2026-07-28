import type { PendingTrack } from "../server/store";

/** What a metadata source can resolve for one track. Either field may be null. */
export type ProviderResult = {
  durationMs: number | null;
  artworkUrl: string | null;
};

export interface EnrichmentProvider {
  readonly name: string;
  /** Minimum gap between two calls to this provider, in milliseconds. */
  readonly minIntervalMs: number;
  /**
   * Returns what the source knows, or null when it has no match.
   *
   * Throwing and returning null mean different things to the sweep: null is a
   * genuine miss and counts toward marking the track attempted, a throw is a
   * transient failure and leaves the track pending for a later run.
   */
  lookup(track: PendingTrack): Promise<ProviderResult | null>;
}

export function isUsable(result: ProviderResult | null): boolean {
  return result !== null && (result.durationMs !== null || result.artworkUrl !== null);
}
