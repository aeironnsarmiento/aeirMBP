"use client";

import { useRef } from "react";
import { ImageCropper } from "@/components/media/ImageCropper/ImageCropper";
import { shouldCrop } from "@/components/media/cropGeometry";
import { PROFILE } from "@/lib/site/profile";
import { ASSET_RULES, formatMegabytes } from "@/lib/site/schema";
import { initialsFor } from "@/widgets/music/format";
import { failureMessage } from "@/widgets/settings/http/rejection";
import type { PendingAsset } from "@/widgets/settings/usePendingAsset";
import type {
  SettingsActivityKey,
  SettingsActivityStatus,
} from "@/widgets/settings/useSettingsActivity";
import { SettingsButton } from "../../components/SettingsActions/SettingsActions";
import { SettingsSection } from "../../components/SettingsSection/SettingsSection";
import styles from "./AvatarSection.module.css";

export type AvatarSectionProps = {
  avatarUrl: string | null;
  busy: SettingsActivityKey | null;
  pendingAsset: PendingAsset | null;
  beginActivity: (key: SettingsActivityKey) => void;
  reportActivity: (result: SettingsActivityStatus) => void;
  endActivity: () => void;
  selectPendingAsset: (asset: PendingAsset) => void;
  clearPendingAsset: () => void;
  refresh: () => void;
};

const AVATAR_CROP = {
  aspect: 1,
  maxWidth: 512,
  confirm: "Use this avatar",
} as const;

export function AvatarSection({
  avatarUrl,
  busy,
  pendingAsset,
  beginActivity,
  reportActivity,
  endActivity,
  selectPendingAsset,
  clearPendingAsset,
  refresh,
}: AvatarSectionProps) {
  const fileInput = useRef<HTMLInputElement>(null);

  function chooseAvatar(file: File) {
    reportActivity(null);
    if (shouldCrop(file.type)) {
      selectPendingAsset({ kind: "avatar", file });
      return;
    }
    void uploadAvatar(file);
  }

  function croppedAvatar(file: File) {
    clearPendingAsset();
    void uploadAvatar(file);
  }

  async function uploadAvatar(file: File) {
    beginActivity("avatar");
    try {
      const form = new FormData();
      form.set("avatar", file);
      const response = await fetch("/api/settings", { method: "POST", body: form });
      if (!response.ok) throw new Error(await failureMessage(response));

      reportActivity({ tone: "ok", message: "Avatar updated." });
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
      title="Avatar"
      note={
        <>
          Cropped square · PNG, JPEG, WebP or GIF, up to{" "}
          {formatMegabytes(ASSET_RULES.avatar.maxBytes)}
        </>
      }
    >
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) chooseAvatar(file);
          event.target.value = "";
        }}
      />

      {pendingAsset?.kind === "avatar" ? (
        <ImageCropper
          key={`${pendingAsset.file.name}:${pendingAsset.file.size}`}
          file={pendingAsset.file}
          aspect={AVATAR_CROP.aspect}
          maxWidth={AVATAR_CROP.maxWidth}
          label="avatar"
          confirmLabel={
            busy === "avatar" ? "Uploading…" : AVATAR_CROP.confirm
          }
          busy={busy !== null}
          onCancel={clearPendingAsset}
          onCommit={croppedAvatar}
        />
      ) : (
        <div className={styles.avatarRow}>
          <div className={styles.avatarPreview}>
            {initialsFor(PROFILE.name)}
            {avatarUrl ? (
              <img className={styles.avatarImage} src={avatarUrl} alt="" />
            ) : null}
          </div>
          <SettingsButton
            type="button"
            disabled={busy !== null}
            onClick={() => fileInput.current?.click()}
          >
            {busy === "avatar" ? "Uploading…" : "Upload an avatar"}
          </SettingsButton>
        </div>
      )}
    </SettingsSection>
  );
}
