"use client";

import { useEffect, useState } from "react";
import { useMusicVersion } from "./freshness";
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

export function useMusic({
  view,
  range,
  limit,
}: MusicRequest): MusicState & { summary: MusicSummary | null } {
  const key = `${view}|${range ?? ""}|${limit ?? ""}`;
  // Not part of `key`: a refresh swaps the data in place instead of dropping
  // back to the skeleton.
  const version = useMusicVersion();
  const [tracked, setTracked] = useState<Tracked>({ key, status: "loading" });

  const [summary, setSummary] = useState<MusicSummary | null>(null);

  if (tracked.key !== key) setTracked({ key, status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ view });
    if (range) params.set("range", range);
    if (limit) params.set("limit", String(limit));

    fetch(`/api/music?${params}`, {
      signal: controller.signal,
      cache: "no-store",
    })
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
  }, [key, view, range, limit, version]);

  return { ...tracked, summary };
}
