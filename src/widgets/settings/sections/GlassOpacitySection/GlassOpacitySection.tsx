"use client";

import { useState } from "react";
import {
  GLASS_OPACITY_MAX,
  GLASS_OPACITY_MIN,
} from "@/lib/site/schema";
import {
  postSettingsPatch,
  type SettingsPatch,
} from "@/widgets/settings/http/settingsPatch";
import type {
  SettingsActivityKey,
  SettingsActivityStatus,
} from "@/widgets/settings/useSettingsActivity";
import { SettingsSection } from "../../components/SettingsSection/SettingsSection";
import styles from "./GlassOpacitySection.module.css";

export type GlassOpacitySectionProps = {
  frameOpacity: number;
  paneOpacity: number;
  busy: SettingsActivityKey | null;
  beginActivity: (key: SettingsActivityKey) => void;
  reportActivity: (result: SettingsActivityStatus) => void;
  endActivity: () => void;
  refresh: () => void;
};

type OpacityPatch = Pick<SettingsPatch, "frameOpacity" | "paneOpacity">;

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

export function GlassOpacitySection({
  frameOpacity: initialFrameOpacity,
  paneOpacity: initialPaneOpacity,
  busy,
  beginActivity,
  reportActivity,
  endActivity,
  refresh,
}: GlassOpacitySectionProps) {
  const [frameOpacity, setFrameOpacity] = useState(initialFrameOpacity);
  const [paneOpacity, setPaneOpacity] = useState(initialPaneOpacity);

  async function save(patch: OpacityPatch) {
    beginActivity("opacity");
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

  return (
    <SettingsSection
      title="Glass opacity"
      note="The frame, and the panes inside it"
    >
      <OpacityRow
        label="Frame"
        value={frameOpacity}
        disabled={busy !== null}
        onChange={setFrameOpacity}
        onCommit={() => void save({ frameOpacity })}
      />
      <OpacityRow
        label="Panes"
        value={paneOpacity}
        disabled={busy !== null}
        onChange={setPaneOpacity}
        onCommit={() => void save({ paneOpacity })}
      />
    </SettingsSection>
  );
}
