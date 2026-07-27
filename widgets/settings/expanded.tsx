"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { GlassSurface } from "@/components/glass/GlassSurface";
import { ImageCropper } from "@/components/media/ImageCropper";
import { shouldCrop } from "@/components/media/cropGeometry";
import { useSite } from "@/components/shell/SiteContext";
import type { WidgetExpandedProps } from "@/lib/registry/types";
import {
  ASSET_RULES,
  GLASS_OPACITY_MAX,
  GLASS_OPACITY_MIN,
  formatMegabytes,
  validateAsset,
  type AssetKind,
} from "@/lib/site/schema";
import { BACKGROUNDS, CUSTOM_BACKGROUND_ID } from "@/lib/theme/backgrounds";
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
 * The two sweeps run against different sources at different rates, so one
 * combined figure hid which of them still had work. It also read as "tracks
 * pending" while counting artists too, which made a finished track sweep look
 * stuck.
 */
type EnrichmentPending = { tracks: number; artists: number };

function describePending(pending: EnrichmentPending | null): string {
  if (pending === null) return "—";
  const { tracks, artists } = pending;
  if (tracks === 0 && artists === 0) return "complete";
  return `${tracks.toLocaleString()} tracks · ${artists.toLocaleString()} artists pending`;
}

/** Mirrors the storage handler's response. Restated so this client file never
 *  value-imports `lib/site/storage`, which carries the storage SDK. */
type StorageReport = { ok: boolean; fault: string | null; message: string };

/**
 * How each asset is framed (R11, R17).
 *
 * The aspect matches how the image is finally rendered — the avatar is a
 * square tile, the background is cover-fitted across the viewport — so what
 * the owner frames is what the site shows. The width caps keep an 8000px
 * camera file from being stored, and served, at full size.
 */
const CROPS = {
  avatar: { aspect: 1, maxWidth: 512, confirm: "Use this avatar" },
  background: { aspect: 16 / 9, maxWidth: 2560, confirm: "Use this background" },
} as const satisfies Record<
  AssetKind,
  { aspect: number; maxWidth: number; confirm: string }
>;

type Pending = { kind: AssetKind; file: File };

/** One opacity dial. Two of these, differing only in which value they own. */
function OpacityRow({
  label,
  value,
  disabled,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>{label}</span>
      <input
        className={styles.slider}
        type="range"
        min={GLASS_OPACITY_MIN}
        max={GLASS_OPACITY_MAX}
        step={0.01}
        value={value}
        aria-label={`${label} opacity`}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
      <span className={styles.sliderValue}>{value.toFixed(2)}</span>
    </div>
  );
}

/**
 * The owner's control surface (R32, R33).
 *
 * A registry entry that expands into the same glass modal as every other
 * widget, not a separate page — which is what keeps the site one place rather
 * than a site plus an admin panel.
 */
export function SettingsExpanded({ openWidget }: WidgetExpandedProps) {
  const router = useRouter();
  const { settings, avatarUrl, backgroundUrl } = useSite();

  const [frameOpacity, setFrameOpacity] = useState(settings.frameOpacity);
  const [paneOpacity, setPaneOpacity] = useState(settings.paneOpacity);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadedBackgroundName, setUploadedBackgroundName] = useState<string | null>(null);
  const [backfill, setBackfill] = useState<BackfillProgress | null>(null);
  const [pendingEnrichment, setPendingEnrichment] =
    useState<EnrichmentPending | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [storage, setStorage] = useState<StorageReport | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);

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

  /**
   * A chosen file goes to the cropper first, unless cropping it would destroy
   * it: drawing a GIF to a canvas keeps one frame and drops the animation, so
   * animated files are uploaded exactly as they are (R12).
   */
  function chooseFile(kind: AssetKind, file: File) {
    setStatus(null);
    if (shouldCrop(file.type)) {
      setPending({ kind, file });
      return;
    }
    void (kind === "avatar" ? uploadAvatar(file) : uploadBackground(file));
  }

  function cropped(kind: AssetKind, file: File) {
    setPending(null);
    void (kind === "avatar" ? uploadAvatar(file) : uploadBackground(file));
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

  /**
   * Three steps, because the file never touches this server (R13): ask for
   * permission, send the bytes straight to storage, then report the path.
   */
  async function uploadBackground(file: File) {
    setBusy("background");
    setStatus(null);
    try {
      validateAsset("background", file);

      const granted = await fetch("/api/settings/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: file.type, size: file.size }),
      });
      const target = await granted.json();
      if (!granted.ok) {
        throw new Error(target?.error ?? `HTTP ${granted.status}`);
      }

      const stored = await fetch(target.signedUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!stored.ok) {
        throw new Error(`Storage refused the file (HTTP ${stored.status}).`);
      }

      const confirmed = await fetch("/api/settings/upload", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: target.path }),
      });
      const body = await confirmed.json();
      if (!confirmed.ok) {
        throw new Error(body?.error ?? `HTTP ${confirmed.status}`);
      }

      setStatus({ tone: "ok", message: "Background updated for every visitor." });
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

  /**
   * Both storage actions read the same way: one verdict in, one line out.
   * `repair` is the same endpoint with a POST, so the panel never has to know
   * which bucket setting was wrong — only whether the fault is one code can
   * fix at all.
   */
  async function storageAction(mode: "check" | "repair") {
    setBusy("storage");
    setStatus(null);
    try {
      const response = await fetch("/api/settings/storage", {
        method: mode === "check" ? "GET" : "POST",
        cache: "no-store",
      });
      const body = (await response.json()) as StorageReport & { error?: string };
      if (!response.ok) {
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }

      setStorage(body);
      setStatus({ tone: body.ok ? "ok" : "error", message: body.message });
    } catch (error) {
      setStorage(null);
      setStatus({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Could not check storage.",
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

          {/* One more entry, not a separate mode — the committed set stays
              selectable so a bad upload is never a dead end (R11). */}
          {backgroundUrl ? (
            <button
              type="button"
              className={styles.background}
              style={{ backgroundImage: `url(${backgroundUrl})` }}
              aria-pressed={settings.backgroundId === CUSTOM_BACKGROUND_ID}
              aria-label="Use your uploaded background"
              disabled={busy !== null}
              onClick={() =>
                save({ backgroundId: CUSTOM_BACKGROUND_ID }, "background")
              }
            >
              <span className={styles.backgroundLabel}>
                {uploadedBackgroundName ?? "Yours"}
              </span>
            </button>
          ) : null}
        </div>

        <input
          ref={backgroundInput}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              setUploadedBackgroundName(file.name);
              chooseFile("background", file);
            }
            event.target.value = "";
          }}
        />

        {pending?.kind === "background" ? (
          <ImageCropper
            // A new file is a new crop: remounting resets the zoom and framing.
            key={`${pending.file.name}:${pending.file.size}`}
            file={pending.file}
            aspect={CROPS.background.aspect}
            maxWidth={CROPS.background.maxWidth}
            label="background"
            confirmLabel={
              busy === "background" ? "Uploading…" : CROPS.background.confirm
            }
            busy={busy !== null}
            onCancel={() => setPending(null)}
            onCommit={(file) => cropped("background", file)}
          />
        ) : (
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.button}
              disabled={busy !== null}
              onClick={() => backgroundInput.current?.click()}
            >
              {busy === "background"
                ? "Uploading…"
                : `Upload your own (up to ${formatMegabytes(ASSET_RULES.background.maxBytes)}, GIFs welcome)`}
            </button>
            <span className={styles.sectionNote}>
              Cropped to 16:9. Animated GIFs upload whole.
            </span>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Glass opacity</span>
          <span className={styles.sectionNote}>
            The frame, and the panes inside it
          </span>
        </div>
        <OpacityRow
          label="Frame"
          value={frameOpacity}
          disabled={busy !== null}
          onChange={setFrameOpacity}
          onCommit={() => save({ frameOpacity }, "opacity")}
        />
        <OpacityRow
          label="Panes"
          value={paneOpacity}
          disabled={busy !== null}
          onChange={setPaneOpacity}
          onCommit={() => save({ paneOpacity }, "opacity")}
        />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Avatar</span>
          <span className={styles.sectionNote}>
            Cropped square · PNG, JPEG, WebP or GIF, up to{" "}
            {formatMegabytes(ASSET_RULES.avatar.maxBytes)}
          </span>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) chooseFile("avatar", file);
            event.target.value = "";
          }}
        />

        {pending?.kind === "avatar" ? (
          <ImageCropper
            // A new file is a new crop: remounting resets the zoom and framing.
            key={`${pending.file.name}:${pending.file.size}`}
            file={pending.file}
            aspect={CROPS.avatar.aspect}
            maxWidth={CROPS.avatar.maxWidth}
            label="avatar"
            confirmLabel={busy === "avatar" ? "Uploading…" : CROPS.avatar.confirm}
            busy={busy !== null}
            onCancel={() => setPending(null)}
            onCommit={(file) => cropped("avatar", file)}
          />
        ) : (
          <div className={styles.avatarRow}>
            <div className={styles.avatarPreview}>
              {initialsFor(settings.name || "?")}
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- avoids the metered image optimizer
                <img className={styles.avatarImage} src={avatarUrl} alt="" />
              ) : null}
            </div>
            <button
              type="button"
              className={styles.button}
              disabled={busy !== null}
              onClick={() => fileInput.current?.click()}
            >
              {busy === "avatar" ? "Uploading…" : "Upload an avatar"}
            </button>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Storage</span>
          <span className={styles.sectionNote}>
            Where avatars and backgrounds live
          </span>
        </div>
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.button}
            disabled={busy !== null}
            onClick={() => void storageAction("check")}
          >
            {busy === "storage" ? "Checking…" : "Check storage"}
          </button>

          {/* Offered only for a fault a bucket setting can fix. A bad
              credential lives in the deployment's environment, and no button
              here can mint a good one. */}
          {storage && !storage.ok && storage.fault !== "credential" ? (
            <button
              type="button"
              className={styles.button}
              disabled={busy !== null}
              onClick={() => void storageAction("repair")}
            >
              {storage.fault === "bucket" ? "Create the bucket" : "Fix the bucket"}
            </button>
          ) : null}
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
            Backfill and track enrichment advance one batch per run; artist
            portraits drain in one
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
            <span>{describePending(pendingEnrichment)}</span>
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
