"use client";

import { useEffect, useState } from "react";
import { GlassSurface } from "@/components/glass/GlassSurface";
import { failureMessage } from "@/widgets/settings/http/rejection";
import type {
  SettingsActivityKey,
  SettingsActivityStatus,
} from "@/widgets/settings/useSettingsActivity";
import {
  SettingsActions,
  SettingsButton,
} from "../../components/SettingsActions/SettingsActions";
import { SettingsSection } from "../../components/SettingsSection/SettingsSection";
import styles from "./ListeningDataSection.module.css";

type BackfillProgress = {
  status: string;
  page: number;
  totalPages: number | null;
  insertedTotal: number;
  storedScrobbles: number;
  lastRunAt: string | null;
  lastError: string | null;
};

type EnrichmentPending = { tracks: number; artists: number };

export type ListeningDataSectionProps = {
  busy: SettingsActivityKey | null;
  beginActivity: (key: SettingsActivityKey) => void;
  reportActivity: (result: SettingsActivityStatus) => void;
  endActivity: () => void;
};

function describePending(pending: EnrichmentPending | null): string {
  if (pending === null) return "—";
  const { tracks, artists } = pending;
  if (tracks === 0 && artists === 0) return "complete";
  return `${tracks.toLocaleString()} tracks · ${artists.toLocaleString()} artists pending`;
}

export function ListeningDataSection({
  busy,
  beginActivity,
  reportActivity,
  endActivity,
}: ListeningDataSectionProps) {
  const [backfill, setBackfill] = useState<BackfillProgress | null>(null);
  const [pendingEnrichment, setPendingEnrichment] =
    useState<EnrichmentPending | null>(null);

  useEffect(() => {
    void refreshJobs();
  }, []);

  async function refreshJobs() {
    try {
      const [settingsResponse, enrichResponse] = await Promise.all([
        fetch("/api/settings", { cache: "no-store" }),
        fetch("/api/music/enrich", { cache: "no-store" }),
      ]);
      if (settingsResponse.ok) {
        const body = await settingsResponse.json();
        setBackfill(body.backfill as BackfillProgress);
      }
      if (enrichResponse.ok) {
        const body = await enrichResponse.json();
        setPendingEnrichment({
          tracks: body.tracks as number,
          artists: body.artists as number,
        });
      }
    } catch {
    }
  }

  async function runJob(
    path: string,
    label: Extract<SettingsActivityKey, "Backfill" | "Enrichment">,
  ) {
    beginActivity(label);
    try {
      const response = await fetch(path, { method: "POST" });
      if (!response.ok) throw new Error(await failureMessage(response));
      const body = await response.json();

      reportActivity({
        tone: "ok",
        message: body.done
          ? `${label} complete.`
          : `${label} advanced — run it again to continue.`,
      });
      await refreshJobs();
    } catch (error) {
      reportActivity({
        tone: "error",
        message: error instanceof Error ? error.message : `${label} failed.`,
      });
    } finally {
      endActivity();
    }
  }

  const backfillShare =
    backfill?.totalPages && backfill.totalPages > 0
      ? Math.min(1, (backfill.page - 1) / backfill.totalPages)
      : 0;

  return (
    <SettingsSection
      title="Listening data"
      note={
        <>
          Backfill and track enrichment advance one batch per run; artist
          portraits drain in one
        </>
      }
    >

      <GlassSurface tone="well" className={styles.progress}>
        <div className={styles.progressLine}>
          <span>backfill · {backfill?.status ?? "idle"}</span>
          <span>
            {backfill
              ? `page ${backfill.page}${
                  backfill.totalPages ? ` / ${backfill.totalPages}` : ""
                } · ${backfill.storedScrobbles.toLocaleString()} stored`
              : "—"}
          </span>
        </div>
        <div className={styles.progressTrack}>
          <div
            className={styles.progressFill}
            style={{ width: `${Math.round(backfillShare * 100)}%` }}
          />
        </div>
        {backfill?.lastError ? (
          <div className={styles.progressLine}>
            <span>last error</span>
            <span>{backfill.lastError}</span>
          </div>
        ) : null}
        <div className={styles.progressLine}>
          <span>enrichment</span>
          <span>{describePending(pendingEnrichment)}</span>
        </div>
      </GlassSurface>

      <SettingsActions>
        <SettingsButton
          type="button"
          disabled={busy !== null}
          onClick={() => runJob("/api/music/backfill", "Backfill")}
        >
          {busy === "Backfill" ? "Importing…" : "Run backfill"}
        </SettingsButton>
        <SettingsButton
          type="button"
          disabled={busy !== null}
          onClick={() => runJob("/api/music/enrich", "Enrichment")}
        >
          {busy === "Enrichment" ? "Enriching…" : "Run enrichment"}
        </SettingsButton>
        <SettingsButton
          type="button"
          disabled={busy !== null}
          onClick={() => void refreshJobs()}
        >
          Refresh status
        </SettingsButton>
      </SettingsActions>
    </SettingsSection>
  );
}
