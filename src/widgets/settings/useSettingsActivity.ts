"use client";

import { useCallback, useState } from "react";
import type { Appearance } from "@/lib/site/schema";

export type SettingsActivityKey =
  | "background"
  | `background:${Appearance}`
  | "remove"
  | `remove:${Appearance}`
  | "schedule"
  | "opacity"
  | "avatar"
  | "storage"
  | "Backfill"
  | "Enrichment";

export type SettingsActivityStatus = {
  tone: "ok" | "error";
  message: string;
} | null;

export function useSettingsActivity() {
  const [busy, setBusy] = useState<SettingsActivityKey | null>(null);
  const [status, setStatus] = useState<SettingsActivityStatus>(null);

  const beginActivity = useCallback((key: SettingsActivityKey) => {
    setBusy(key);
    setStatus(null);
  }, []);

  const reportActivity = useCallback((result: SettingsActivityStatus) => {
    setStatus(result);
  }, []);

  const endActivity = useCallback(() => {
    setBusy(null);
  }, []);

  return { busy, status, beginActivity, reportActivity, endActivity };
}
