"use client";

import { useCallback, useState } from "react";
import type { Appearance, AssetKind } from "@/lib/site/schema";

export type PendingAsset = {
  kind: AssetKind;
  file: File;
  appearance?: Appearance;
};

export function usePendingAsset() {
  const [pendingAsset, setPendingAsset] = useState<PendingAsset | null>(null);

  const selectPendingAsset = useCallback((asset: PendingAsset) => {
    setPendingAsset(asset);
  }, []);

  const clearPendingAsset = useCallback(() => {
    setPendingAsset(null);
  }, []);

  return { pendingAsset, selectPendingAsset, clearPendingAsset };
}
