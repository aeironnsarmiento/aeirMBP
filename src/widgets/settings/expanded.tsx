"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { GlassSurface } from "@/components/glass/GlassSurface";
import { ImageCropper } from "@/components/media/ImageCropper";
import { shouldCrop } from "@/components/media/cropGeometry";
import { useSite } from "@/components/shell/SiteContext";
import { afterTransitions } from "@/components/shell/useOpenWidget";
import {
  applyTheme,
  currentTheme,
  holdScheduledTheme,
  otherTheme,
  recomputeTheme,
} from "@/components/glass/useTheme";
import { failureMessage } from "@/lib/http/rejection";
import { transcodeAnimation } from "@/lib/media/transcodeAnimation";
import { PROFILE } from "@/lib/site/profile";
import {
  APPEARANCES,
  ASSET_RULES,
  BACKGROUND_SLOT_FIELDS,
  GLASS_OPACITY_MAX,
  GLASS_OPACITY_MIN,
  formatMegabytes,
  isSwitchoverTime,
  validateAsset,
  type Appearance,
  type AssetKind,
} from "@/lib/site/schema";
import {
  BACKGROUNDS,
  CUSTOM_BACKGROUND_ID,
  backgroundById,
  hasBackgroundPair,
  presetForMood,
} from "@/lib/theme/backgrounds";
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

type Pending = { kind: AssetKind; file: File; appearance?: Appearance };

/** The upload endpoint, told which slot it is for. */
function uploadUrl(appearance?: Appearance): string {
  return appearance
    ? `/api/settings/upload?slot=${appearance}`
    : "/api/settings/upload";
}

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
 * Shows the owner the appearance readers are not getting (R16, KTD8) — the
 * whole appearance, since a dark image under light glass is the mismatch the
 * pair exists to remove. Panel state, so the widget's unmount is the entire
 * teardown. The schedule is held while it is up, and both the apply and the
 * release go through the transition seam.
 */
function usePreview(preview: Appearance | null): void {
  useEffect(() => {
    if (preview === null) return;

    holdScheduledTheme(true);
    afterTransitions(() => applyTheme(preview));

    return () => {
      holdScheduledTheme(false);
      // Re-resolved, not restored: a boundary may have passed meanwhile.
      afterTransitions(() => recomputeTheme());
    };
  }, [preview]);
}

/** One appearance's wallpaper (R8). The slot's upload is one more entry in the
 *  grid rather than a separate mode, so a bad upload is never a dead end. */
function SlotPicker({
  appearance,
  selectedId,
  customUrl,
  disabled,
  busy,
  onSelect,
  onUpload,
  onRemove,
}: {
  appearance: Appearance;
  selectedId: string | null;
  customUrl: string | null;
  disabled: boolean;
  busy: string | null;
  onSelect: (id: string) => void;
  onUpload: () => void;
  onRemove: () => void;
}) {
  const fallback = presetForMood(appearance);

  return (
    <div className={styles.slot}>
      <div className={styles.slotHead}>
        <span className={styles.slotLabel}>
          {appearance === "light" ? "Light appearance" : "Dark appearance"}
        </span>
        {selectedId === null ? (
          <span className={styles.sectionNote}>
            Unset — falling back to {fallback.label}
          </span>
        ) : null}
      </div>
      <div className={styles.backgrounds}>
        {BACKGROUNDS.map((background) => (
          <button
            key={background.id}
            type="button"
            className={styles.background}
            style={{ backgroundImage: `url(${background.src})` }}
            aria-pressed={background.id === selectedId}
            aria-label={`Use the ${background.label} background for ${appearance}`}
            disabled={disabled}
            onClick={() => onSelect(background.id)}
          >
            <span className={styles.backgroundLabel}>{background.label}</span>
          </button>
        ))}
        {customUrl ? (
          <button
            type="button"
            className={styles.background}
            style={{ backgroundImage: `url(${customUrl})` }}
            aria-pressed={selectedId === CUSTOM_BACKGROUND_ID}
            aria-label={`Use your uploaded ${appearance} background`}
            disabled={disabled}
            onClick={() => onSelect(CUSTOM_BACKGROUND_ID)}
          >
            <span className={styles.backgroundLabel}>Yours</span>
          </button>
        ) : null}
      </div>
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.button}
          disabled={disabled}
          onClick={onUpload}
        >
          {busy === `background:${appearance}`
            ? "Uploading…"
            : `Upload a ${appearance} image`}
        </button>
        {selectedId !== null ? (
          <button
            type="button"
            className={styles.button}
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Clear the ${appearance} background`}
          >
            {busy === `remove:${appearance}` ? "Clearing…" : "Clear"}
          </button>
        ) : null}
      </div>
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
export function SettingsExpanded() {
  const router = useRouter();
  const { settings, avatarUrl, backgrounds } = useSite();
  const backgroundUrl = backgrounds.single.customUrl;

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
  const slotUpload = useRef<Record<Appearance, HTMLInputElement | null>>({
    light: null,
    dark: null,
  });

  // Read straight from context, never copied at mount — a copy goes stale the
  // moment a refresh brings new settings in. The sliders keep the copy because
  // they need local state to stay responsive under the pointer.
  const paired = hasBackgroundPair(backgrounds);
  const [preview, setPreview] = useState<Appearance | null>(null);
  usePreview(preview);

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
      if (!response.ok) throw new Error(await failureMessage(response));

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

  /** Both members in one patch — the write layer is transactional per patch,
   *  so two would half-configure every visitor in between (R8). */
  function pairBackgrounds() {
    const single = backgroundById(settings.backgroundId, backgroundUrl);
    void save(
      {
        [BACKGROUND_SLOT_FIELDS.light]: presetForMood("light").id,
        [BACKGROUND_SLOT_FIELDS.dark]:
          single.kind === "image" ? settings.backgroundId : presetForMood("dark").id,
      },
      "background",
    );
  }

  /** Any slot holding an upload goes through the removal endpoint first, so
   *  its bytes are reference-counted rather than orphaned. */
  async function unpairBackgrounds() {
    for (const appearance of APPEARANCES) {
      if (backgrounds[appearance].customUrl) await removeBackground(appearance);
    }
    await save(
      {
        [BACKGROUND_SLOT_FIELDS.light]: null,
        [BACKGROUND_SLOT_FIELDS.dark]: null,
      },
      "background",
    );
  }

  /** Checked before posting so a malformed value is named against its own
   *  field — the same rule the server holds it to, run early enough to help. */
  function commitSwitchover(value: string) {
    if (value === "") {
      void save({ themeSwitchoverAt: null }, "schedule");
      return;
    }
    if (!isSwitchoverTime(value)) {
      setStatus({
        tone: "error",
        message: `Switchover time must be HH:MM between 00:00 and 23:59 (themeSwitchoverAt).`,
      });
      return;
    }
    void save({ themeSwitchoverAt: value }, "schedule");
  }

  /**
   * A chosen file goes to the cropper first, unless cropping it would destroy
   * it: drawing a GIF to a canvas keeps one frame and drops the animation, so
   * animated files are uploaded exactly as they are (R12).
   */
  function chooseFile(kind: AssetKind, file: File, appearance?: Appearance) {
    setStatus(null);
    if (shouldCrop(file.type)) {
      setPending({ kind, file, appearance });
      return;
    }
    void (kind === "avatar"
      ? uploadAvatar(file)
      : uploadBackground(file, appearance));
  }

  function cropped(kind: AssetKind, file: File, appearance?: Appearance) {
    setPending(null);
    void (kind === "avatar"
      ? uploadAvatar(file)
      : uploadBackground(file, appearance));
  }

  async function uploadAvatar(file: File) {
    setBusy("avatar");
    setStatus(null);
    try {
      const form = new FormData();
      form.set("avatar", file);
      const response = await fetch("/api/settings", { method: "POST", body: form });
      if (!response.ok) throw new Error(await failureMessage(response));

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
   * Discards the uploaded background: the stored object and the reference to
   * it both go, and the site returns to a preset.
   */
  /** Clears one slot, or the single background when no appearance is named.
   *  The server reference-counts the bytes; two slots may share an image. */
  async function removeBackground(appearance?: Appearance) {
    setBusy(appearance ? `remove:${appearance}` : "remove");
    setStatus(null);
    try {
      const response = await fetch(uploadUrl(appearance), { method: "DELETE" });
      if (!response.ok) throw new Error(await failureMessage(response));

      setUploadedBackgroundName(null);
      setStatus({ tone: "ok", message: "Background removed." });
      router.refresh();
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Could not remove it.",
      });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Three steps, because the file never touches this server (R13): ask for
   * permission, send the bytes straight to storage, then report the path.
   *
   * An animated image is re-encoded to a looping video first. That is not a
   * format preference: an animated GIF wallpaper repaints the whole viewport
   * every frame, and the frame above it carries the site's one backdrop
   * filter, so each repaint re-blurs the screen. Video decodes on the
   * platform's video path and compresses between frames instead.
   */
  async function uploadBackground(original: File, appearance?: Appearance) {
    setBusy(appearance ? `background:${appearance}` : "background");
    setStatus(null);
    try {
      // Returns the original unless re-encoding actually produced something
      // smaller, so this can only ever reduce what gets uploaded.
      const file = await transcodeAnimation(original);
      if (file !== original) {
        setStatus({
          tone: "ok",
          message: `Animation re-encoded: ${formatMegabytes(original.size)} → ${formatMegabytes(file.size)}.`,
        });
      }

      validateAsset("background", file);

      const granted = await fetch(uploadUrl(appearance), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: file.type, size: file.size }),
      });
      if (!granted.ok) throw new Error(await failureMessage(granted));
      const target = await granted.json();

      const stored = await fetch(target.signedUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!stored.ok) {
        throw new Error(`Storage refused the file (HTTP ${stored.status}).`);
      }

      const confirmed = await fetch(uploadUrl(appearance), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: target.path }),
      });
      if (!confirmed.ok) throw new Error(await failureMessage(confirmed));

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
      if (!response.ok) throw new Error(await failureMessage(response));
      const body = (await response.json()) as StorageReport;

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
      if (!response.ok) throw new Error(await failureMessage(response));
      const body = await response.json();

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
            {paired
              ? "One wallpaper per appearance"
              : "Every visitor sees your choice"}
          </span>
        </div>

        {paired ? (
          APPEARANCES.map((appearance) => (
            <SlotPicker
              key={appearance}
              appearance={appearance}
              selectedId={settings[BACKGROUND_SLOT_FIELDS[appearance]]}
              customUrl={backgrounds[appearance].customUrl}
              disabled={busy !== null}
              onSelect={(id) =>
                save(
                  { [BACKGROUND_SLOT_FIELDS[appearance]]: id },
                  "background",
                )
              }
              onUpload={() => slotUpload.current[appearance]?.click()}
              onRemove={() => removeBackground(appearance)}
              busy={busy}
            />
          ))
        ) : (
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
        )}

        {/* One input per slot, so a chosen file knows its appearance. */}
        {APPEARANCES.map((appearance) => (
          <input
            key={appearance}
            ref={(element) => {
              slotUpload.current[appearance] = element;
            }}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label={`Upload a ${appearance} background`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) chooseFile("background", file, appearance);
              event.target.value = "";
            }}
          />
        ))}

        <div className={styles.buttonRow}>
          {paired ? (
            <button
              type="button"
              className={styles.button}
              disabled={busy !== null}
              onClick={unpairBackgrounds}
            >
              Use one background for both
            </button>
          ) : (
            <button
              type="button"
              className={styles.button}
              disabled={busy !== null}
              onClick={pairBackgrounds}
            >
              Split into a light and dark pair
            </button>
          )}
          <button
            type="button"
            className={styles.button}
            aria-pressed={preview !== null}
            disabled={busy !== null}
            onClick={() =>
              setPreview(preview === null ? otherTheme(currentTheme()) : null)
            }
          >
            {preview === null ? "Preview the other appearance" : "End preview"}
          </button>
          <span className={styles.sectionNote}>
            {preview === null
              ? "Preview swaps the whole appearance for you alone. Visitors see nothing change."
              : `Showing the ${preview} appearance. Only you, and only until this panel closes.`}
          </span>
        </div>

        <input
          ref={backgroundInput}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Upload a background"
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
            onCommit={(file) => cropped("background", file, pending.appearance)}
          />
        ) : paired ? null : (
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
            {backgroundUrl ? (
              <button
                type="button"
                className={styles.button}
                disabled={busy !== null}
                onClick={() => removeBackground()}
              >
                {busy === "remove" ? "Removing…" : "Remove"}
              </button>
            ) : null}
            <span className={styles.sectionNote}>
              Cropped to 16:9. An animated file is re-encoded to a small looping
              video first. Animation is the single-background option only — a
              pair swaps by stylesheet, and a stylesheet cannot swap a video
              element in.
            </span>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>Appearance schedule</span>
          <span className={styles.sectionNote}>
            On each reader&rsquo;s own clock
          </span>
        </div>
        <div className={styles.scheduleRow}>
          <input
            // Keyed on the stored value so a change made elsewhere replaces
            // what is on screen after a refresh, rather than leaving a
            // mount-time copy sitting there looking current.
            key={settings.themeSwitchoverAt ?? "unset"}
            className={styles.timeInput}
            type="time"
            defaultValue={settings.themeSwitchoverAt ?? ""}
            aria-label="Switchover time"
            disabled={busy !== null}
            onChange={(event) => commitSwitchover(event.target.value)}
          />
          <select
            className={styles.select}
            value={settings.themeSwitchoverTo}
            aria-label="Appearance after the switchover"
            disabled={busy !== null}
            onChange={(event) =>
              save({ themeSwitchoverTo: event.target.value as Appearance }, "schedule")
            }
          >
            <option value="dark">turns dark</option>
            <option value="light">turns light</option>
          </select>
          {settings.themeSwitchoverAt ? (
            <button
              type="button"
              className={styles.button}
              disabled={busy !== null}
              onClick={() => commitSwitchover("")}
            >
              Clear
            </button>
          ) : null}
        </div>
        <span className={styles.sectionNote}>
          {settings.themeSwitchoverAt
            ? `${settings.themeSwitchoverAt} until midnight is ${settings.themeSwitchoverTo}; the rest of the day is ${settings.themeSwitchoverTo === "dark" ? "light" : "dark"}. A reader who presses the theme toggle keeps their own choice from then on.`
            : "No schedule. Readers follow their operating system until they choose otherwise."}
        </span>
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
              {initialsFor(PROFILE.name)}
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
