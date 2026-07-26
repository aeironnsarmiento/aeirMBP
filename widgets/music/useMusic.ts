"use client";

import { useEffect, useState } from "react";
import type { MusicSummary } from "./queries/aggregations";
import type { MusicPayload } from "./server/read";

export type MusicResponse = MusicPayload & { summary: MusicSummary };

export type MusicRequest = {
  view: string;
  range?: string;
  limit?: number;
};

export type MusicState =
  | { status: "loading" }
  | { status: "ready"; data: MusicResponse }
  | { status: "error"; message: string };

type Tracked = MusicState & { key: string };

/**
 * Fetches one aggregate surface.
 *
 * Every response comes from local storage, so this hook has no last.fm
 * fallback path — there is nothing to fall back from (AE8).
 */
export function useMusic({
  view,
  range,
  limit,
}: MusicRequest): MusicState & { summary: MusicSummary | null } {
  const key = `${view}|${range ?? ""}|${limit ?? ""}`;
  const [tracked, setTracked] = useState<Tracked>({ key, status: "loading" });

  /*
   * The totals describe the whole library rather than the open view, so they
   * outlive a view switch. Held here instead of alongside `tracked`, which
   * resets to loading on every key change — reading them from the request in
   * flight made them blink out and back on each tab.
   */
  const [summary, setSummary] = useState<MusicSummary | null>(null);

  // Reset during render rather than in an effect: switching sub-view must not
  // paint one frame of the previous view's rows before the effect runs.
  if (tracked.key !== key) setTracked({ key, status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ view });
    if (range) params.set("range", range);
    if (limit) params.set("limit", String(limit));

    fetch(`/api/music?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
        const data = body as MusicResponse;
        setTracked({ key, status: "ready", data });
        setSummary(data.summary);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setTracked({
          key,
          status: "error",
          message: error instanceof Error ? error.message : "Could not load",
        });
      });

    return () => controller.abort();
  }, [key, view, range, limit]);

  return { ...tracked, summary };
}
