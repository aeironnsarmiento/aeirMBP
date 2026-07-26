"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { GlassSurface } from "@/components/glass/GlassSurface";
import { useSite } from "@/components/shell/SiteContext";
import type { WidgetExpandedProps } from "@/lib/registry/types";
import { GLASS_OPACITY_MAX, GLASS_OPACITY_MIN } from "@/lib/site/schema";
import { BACKGROUNDS } from "@/lib/theme/backgrounds";
import { initialsFor } from "@/widgets/music/format";
import styles from "./settings.module.css";

type BackfillProgress = {
  status: string;
  page: number;
  totalPages: number | null;
  insertedTotal: number;
  storedScrobbles: number;
  lastRunAt: string | null;
  lastError: string | null;
};

type Status = { tone: "ok" | "error"; message: string } | null;

/**
 * The owner's control surface (R32, R33).
 *
 * A registry entry that expands into the same glass modal as every other
 * widget, not a separate page — which is what keeps the site one place rather
 * than a site plus an admin panel.
 */
export function SettingsExpanded({ openWidget }: WidgetExpandedProps) {
  const router = useRouter();
  const { settings, avatarUrl } = useSite();

  const [opacity, setOpacity] = useState(settings.glassOpacity);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [backfill, setBackfill] = useState<BackfillProgress | null>(null);
  const [pendingEnrichment, setPendingEnrichment] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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
        setPendingEnrichment(body.remaining as number);
      }
    } catch {
      // Status display only; a failure here must not break the panel.
    }
  }

  async function save(patch: Record<string, unknown>, label: string) {
    setBusy(label);
    setStatus(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);

      setStatus({ tone: "ok", message: "Saved for every visitor." });
      router.refresh();
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Could not save.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function uploadAvatar(file: File) {
    setBusy("avatar");
    setStatus(null);
    try {
      const form = new FormData();
      form.set("avatar", file);
      const response = await fetch("/api/settings", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);

      setStatus({ tone: "ok", message: "Avatar updated." });
      router.refresh();
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Upload failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function runJob(path: string, label: string) {
    setBusy(label);
    setStatus(null);
    try {
      const response = await fetch(path, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);

      setStatus({
        tone: "ok",
        message: body.done
          ? `${label} complete.`
          : `${label} advanced — run it again to continue.`,
      });
      await refreshJobs();
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : `${label} failed.`,
      });
    } finally {
      setBusy(null);
    }
  }

  const backfillShare =
    backfill?.totalPages && backfill.totalPages > 0
      ? Math.min(1, (backfill.page - 1) / backfill.totalPages)
      : 0;

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Background</span>
          <span className={styles.sectionNote}>
            Every visitor sees your choice
          </span>
        </div>
        <div className={styles.backgrounds}>
          {BACKGROUNDS.map((background) => (
            <button
              key={background.id}
              type="button"
              className={styles.background}
              style={{ backgroundImage: `url(${background.src})` }}
              aria-pressed={background.id === settings.backgroundId}
              aria-label={`Use the ${background.label} background`}
              disabled={busy !== null}
              onClick={() => save({ backgroundId: background.id }, "background")}
            >
              <span className={styles.backgroundLabel}>{background.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Glass opacity</span>
        </div>
        <div className={styles.sliderRow}>
          <input
            className={styles.slider}
            type="range"
            min={GLASS_OPACITY_MIN}
            max={GLASS_OPACITY_MAX}
            step={0.01}
            value={opacity}
            aria-label="Glass opacity"
            onChange={(event) => setOpacity(Number(event.target.value))}
            onPointerUp={() => save({ glassOpacity: opacity }, "opacity")}
            onKeyUp={() => save({ glassOpacity: opacity }, "opacity")}
          />
          <span className={styles.sliderValue}>{opacity.toFixed(2)}</span>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Avatar</span>
          <span className={styles.sectionNote}>PNG, JPEG, WebP or GIF, up to 2MB</span>
        </div>
        <div className={styles.avatarRow}>
          <div className={styles.avatarPreview}>
            {initialsFor(settings.name || "?")}
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- avoids the metered image optimizer
              <img className={styles.avatarImage} src={avatarUrl} alt="" />
            ) : null}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadAvatar(file);
            }}
          />
          <button
            type="button"
            className={styles.button}
            disabled={busy !== null}
            onClick={() => fileInput.current?.click()}
          >
            {busy === "avatar" ? "Uploading…" : "Upload an avatar"}
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>About</span>
        </div>
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.button}
            // Opens About's own editor rather than growing a second copy of it.
            onClick={() => openWidget("about", { params: { edit: "1" } })}
          >
            Edit bio, links and handle
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Listening data</span>
          <span className={styles.sectionNote}>
            Both jobs run in batches — trigger repeatedly until complete
          </span>
        </div>

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
            <span>
              {pendingEnrichment === null
                ? "—"
                : `${pendingEnrichment.toLocaleString()} tracks pending`}
            </span>
          </div>
        </GlassSurface>

        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.button}
            disabled={busy !== null}
            onClick={() => runJob("/api/music/backfill", "Backfill")}
          >
            {busy === "Backfill" ? "Importing…" : "Run backfill"}
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={busy !== null}
            onClick={() => runJob("/api/music/enrich", "Enrichment")}
          >
            {busy === "Enrichment" ? "Enriching…" : "Run enrichment"}
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={busy !== null}
            onClick={() => void refreshJobs()}
          >
            Refresh status
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.button}
            onClick={async () => {
              await fetch("/api/auth", { method: "DELETE" });
              router.refresh();
            }}
          >
            Sign out
          </button>
          {status ? (
            <span className={styles.status} data-tone={status.tone}>
              {status.message}
            </span>
          ) : null}
        </div>
      </section>
    </div>
  );
}
