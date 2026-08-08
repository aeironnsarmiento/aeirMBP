import type { PendingTrack } from "../server/store";

export type ProviderResult = {
  durationMs: number | null;
  artworkUrl: string | null;
};

export interface EnrichmentProvider {
  readonly name: string;
  readonly minIntervalMs: number;
  lookup(track: PendingTrack): Promise<ProviderResult | null>;
}

export function isUsable(result: ProviderResult | null): boolean {
  return result !== null && (result.durationMs !== null || result.artworkUrl !== null);
}
