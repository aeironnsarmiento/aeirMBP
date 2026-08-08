"use client";

import { useEffect, useRef, useState } from "react";
import { ImageCropper } from "@/components/media/ImageCropper/ImageCropper";
import { shouldCrop } from "@/components/media/cropGeometry";
import {
  applyTheme,
  currentTheme,
  holdScheduledTheme,
  otherTheme,
  recomputeTheme,
} from "@/components/glass/useTheme";
import { afterTransitions } from "@/components/shell/useOpenWidget";
import {
  APPEARANCES,
  ASSET_RULES,
  BACKGROUND_SLOT_FIELDS,
  formatMegabytes,
  validateAsset,
  type Appearance,
  type SiteSettings,
} from "@/lib/site/schema";
import {
  BACKGROUNDS,
  CUSTOM_BACKGROUND_ID,
  backgroundById,
  hasBackgroundPair,
  presetForMood,
  type BackgroundSlots,
} from "@/lib/theme/backgrounds";
import { failureMessage } from "@/widgets/settings/http/rejection";
import {
  postSettingsPatch,
  type SettingsPatch,
} from "@/widgets/settings/http/settingsPatch";
import { transcodeAnimation } from "@/widgets/settings/media/transcodeAnimation";
import type { PendingAsset } from "@/widgets/settings/usePendingAsset";
import type {
  SettingsActivityKey,
  SettingsActivityStatus,
} from "@/widgets/settings/useSettingsActivity";
import {
  SettingsActions,
  SettingsButton,
} from "../../components/SettingsActions/SettingsActions";
import {
  SettingsNote,
  SettingsSection,
} from "../../components/SettingsSection/SettingsSection";
import styles from "./BackgroundSection.module.css";

export type BackgroundSectionProps = {
  settings: SiteSettings;
  backgrounds: BackgroundSlots;
  busy: SettingsActivityKey | null;
  pendingAsset: PendingAsset | null;
  beginActivity: (key: SettingsActivityKey) => void;
  reportActivity: (result: SettingsActivityStatus) => void;
  endActivity: () => void;
  selectPendingAsset: (asset: PendingAsset) => void;
  clearPendingAsset: () => void;
  refresh: () => void;
};

const BACKGROUND_CROP = {
  aspect: 16 / 9,
  maxWidth: 2560,
  confirm: "Use this background",
} as const;

type BackgroundPatch = Pick<
  SettingsPatch,
  "backgroundId" | "backgroundLightId" | "backgroundDarkId"
>;

function uploadUrl(appearance?: Appearance): string {
  return appearance
    ? `/api/settings/upload?slot=${appearance}`
    : "/api/settings/upload";
}

function usePreview(preview: Appearance | null): void {
  useEffect(() => {
    if (preview === null) return;

    holdScheduledTheme(true);
    afterTransitions(() => applyTheme(preview));

    return () => {
      holdScheduledTheme(false);
      afterTransitions(() => recomputeTheme());
    };
  }, [preview]);
}

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
  busy: SettingsActivityKey | null;
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
          <SettingsNote>
            Unset — falling back to {fallback.label}
          </SettingsNote>
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
      <SettingsActions>
        <SettingsButton
          type="button"
          disabled={disabled}
          onClick={onUpload}
        >
          {busy === `background:${appearance}`
            ? "Uploading…"
            : `Upload a ${appearance} image`}
        </SettingsButton>
        {selectedId !== null ? (
          <SettingsButton
            type="button"
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Clear the ${appearance} background`}
          >
            {busy === `remove:${appearance}` ? "Clearing…" : "Clear"}
          </SettingsButton>
        ) : null}
      </SettingsActions>
    </div>
  );
}

export function BackgroundSection({
  settings,
  backgrounds,
  busy,
  pendingAsset,
  beginActivity,
  reportActivity,
  endActivity,
  selectPendingAsset,
  clearPendingAsset,
  refresh,
}: BackgroundSectionProps) {
  const backgroundUrl = backgrounds.single.customUrl;
  const paired = hasBackgroundPair(backgrounds);
  const [uploadedBackgroundName, setUploadedBackgroundName] = useState<
    string | null
  >(null);
  const [preview, setPreview] = useState<Appearance | null>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const slotUpload = useRef<Record<Appearance, HTMLInputElement | null>>({
    light: null,
    dark: null,
  });
  usePreview(preview);

  async function save(patch: BackgroundPatch) {
    beginActivity("background");
    try {
      await postSettingsPatch(patch);

      reportActivity({ tone: "ok", message: "Saved for every visitor." });
      refresh();
    } catch (error) {
      reportActivity({
        tone: "error",
        message: error instanceof Error ? error.message : "Could not save.",
      });
    } finally {
      endActivity();
    }
  }

  function pairBackgrounds() {
    const single = backgroundById(settings.backgroundId, backgroundUrl);
    void save(
      {
        [BACKGROUND_SLOT_FIELDS.light]: presetForMood("light").id,
        [BACKGROUND_SLOT_FIELDS.dark]:
          single.kind === "image"
            ? settings.backgroundId
            : presetForMood("dark").id,
      },
    );
  }

  async function unpairBackgrounds() {
    for (const appearance of APPEARANCES) {
      if (backgrounds[appearance].customUrl) await removeBackground(appearance);
    }
    await save(
      {
        [BACKGROUND_SLOT_FIELDS.light]: null,
        [BACKGROUND_SLOT_FIELDS.dark]: null,
      },
    );
  }

  function chooseFile(file: File, appearance?: Appearance) {
    reportActivity(null);
    if (shouldCrop(file.type)) {
      selectPendingAsset({ kind: "background", file, appearance });
      return;
    }
    void uploadBackground(file, appearance);
  }

  function cropped(file: File, appearance?: Appearance) {
    clearPendingAsset();
    void uploadBackground(file, appearance);
  }

  async function removeBackground(appearance?: Appearance) {
    beginActivity(appearance ? `remove:${appearance}` : "remove");
    try {
      const response = await fetch(uploadUrl(appearance), { method: "DELETE" });
      if (!response.ok) throw new Error(await failureMessage(response));

      setUploadedBackgroundName(null);
      reportActivity({ tone: "ok", message: "Background removed." });
      refresh();
    } catch (error) {
      reportActivity({
        tone: "error",
        message: error instanceof Error ? error.message : "Could not remove it.",
      });
    } finally {
      endActivity();
    }
  }

  async function uploadBackground(original: File, appearance?: Appearance) {
    beginActivity(appearance ? `background:${appearance}` : "background");
    try {
      const file = await transcodeAnimation(original);
      if (file !== original) {
        reportActivity({
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

      reportActivity({
        tone: "ok",
        message: "Background updated for every visitor.",
      });
      refresh();
    } catch (error) {
      reportActivity({
        tone: "error",
        message: error instanceof Error ? error.message : "Upload failed.",
      });
    } finally {
      endActivity();
    }
  }

  return (
    <SettingsSection
      title="Background"
      note={
        <>
          {paired
            ? "One wallpaper per appearance"
            : "Every visitor sees your choice"}
        </>
      }
    >

      {paired ? (
        APPEARANCES.map((appearance) => (
          <SlotPicker
            key={appearance}
            appearance={appearance}
            selectedId={settings[BACKGROUND_SLOT_FIELDS[appearance]]}
            customUrl={backgrounds[appearance].customUrl}
            disabled={busy !== null}
            onSelect={(id) =>
              void save({ [BACKGROUND_SLOT_FIELDS[appearance]]: id })
            }
            onUpload={() => slotUpload.current[appearance]?.click()}
            onRemove={() => void removeBackground(appearance)}
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
              onClick={() =>
                void save({ backgroundId: background.id })
              }
            >
              <span className={styles.backgroundLabel}>{background.label}</span>
            </button>
          ))}
          {backgroundUrl ? (
            <button
              type="button"
              className={styles.background}
              style={{ backgroundImage: `url(${backgroundUrl})` }}
              aria-pressed={settings.backgroundId === CUSTOM_BACKGROUND_ID}
              aria-label="Use your uploaded background"
              disabled={busy !== null}
              onClick={() =>
                void save({ backgroundId: CUSTOM_BACKGROUND_ID })
              }
            >
              <span className={styles.backgroundLabel}>
                {uploadedBackgroundName ?? "Yours"}
              </span>
            </button>
          ) : null}
        </div>
      )}
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
            if (file) chooseFile(file, appearance);
            event.target.value = "";
          }}
        />
      ))}

      <SettingsActions>
        {paired ? (
          <SettingsButton
            type="button"
            disabled={busy !== null}
            onClick={() => void unpairBackgrounds()}
          >
            Use one background for both
          </SettingsButton>
        ) : (
          <SettingsButton
            type="button"
            disabled={busy !== null}
            onClick={pairBackgrounds}
          >
            Split into a light and dark pair
          </SettingsButton>
        )}
        <SettingsButton
          type="button"
          aria-pressed={preview !== null}
          disabled={busy !== null}
          onClick={() =>
            setPreview(preview === null ? otherTheme(currentTheme()) : null)
          }
        >
          {preview === null ? "Preview the other appearance" : "End preview"}
        </SettingsButton>
        <SettingsNote>
          {preview === null
            ? "Preview swaps the whole appearance for you alone. Visitors see nothing change."
            : `Showing the ${preview} appearance. Only you, and only until this panel closes.`}
        </SettingsNote>
      </SettingsActions>

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
            chooseFile(file);
          }
          event.target.value = "";
        }}
      />

      {pendingAsset?.kind === "background" ? (
        <ImageCropper
          key={`${pendingAsset.file.name}:${pendingAsset.file.size}`}
          file={pendingAsset.file}
          aspect={BACKGROUND_CROP.aspect}
          maxWidth={BACKGROUND_CROP.maxWidth}
          label="background"
          confirmLabel={
            busy === "background" ? "Uploading…" : BACKGROUND_CROP.confirm
          }
          busy={busy !== null}
          onCancel={clearPendingAsset}
          onCommit={(file) => cropped(file, pendingAsset.appearance)}
        />
      ) : paired ? null : (
        <SettingsActions>
          <SettingsButton
            type="button"
            disabled={busy !== null}
            onClick={() => backgroundInput.current?.click()}
          >
            {busy === "background"
              ? "Uploading…"
              : `Upload your own (up to ${formatMegabytes(ASSET_RULES.background.maxBytes)}, GIFs welcome)`}
          </SettingsButton>
          {backgroundUrl ? (
            <SettingsButton
              type="button"
              disabled={busy !== null}
              onClick={() => void removeBackground()}
            >
              {busy === "remove" ? "Removing…" : "Remove"}
            </SettingsButton>
          ) : null}
          <SettingsNote>
            Cropped to 16:9. An animated file is re-encoded to a small looping
            video first. Animation is the single-background option only — a pair
            swaps by stylesheet, and a stylesheet cannot swap a video element in.
          </SettingsNote>
        </SettingsActions>
      )}
    </SettingsSection>
  );
}
