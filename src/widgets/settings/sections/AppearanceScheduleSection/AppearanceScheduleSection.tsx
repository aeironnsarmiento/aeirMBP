"use client";

import {
  isSwitchoverTime,
  type Appearance,
} from "@/lib/site/schema";
import {
  postSettingsPatch,
  type SettingsPatch,
} from "@/widgets/settings/http/settingsPatch";
import type {
  SettingsActivityKey,
  SettingsActivityStatus,
} from "@/widgets/settings/useSettingsActivity";
import { SettingsButton } from "../../components/SettingsActions/SettingsActions";
import {
  SettingsNote,
  SettingsSection,
} from "../../components/SettingsSection/SettingsSection";
import styles from "./AppearanceScheduleSection.module.css";

export type AppearanceScheduleSectionProps = {
  themeSwitchoverAt: string | null;
  themeSwitchoverTo: Appearance;
  busy: SettingsActivityKey | null;
  beginActivity: (key: SettingsActivityKey) => void;
  reportActivity: (result: SettingsActivityStatus) => void;
  endActivity: () => void;
  refresh: () => void;
};

type SchedulePatch = Pick<
  SettingsPatch,
  "themeSwitchoverAt" | "themeSwitchoverTo"
>;

export function AppearanceScheduleSection({
  themeSwitchoverAt,
  themeSwitchoverTo,
  busy,
  beginActivity,
  reportActivity,
  endActivity,
  refresh,
}: AppearanceScheduleSectionProps) {
  async function save(patch: SchedulePatch) {
    beginActivity("schedule");
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

  function commitSwitchover(value: string) {
    if (value === "") {
      void save({ themeSwitchoverAt: null });
      return;
    }
    if (!isSwitchoverTime(value)) {
      reportActivity({
        tone: "error",
        message: `Switchover time must be HH:MM between 00:00 and 23:59 (themeSwitchoverAt).`,
      });
      return;
    }
    void save({ themeSwitchoverAt: value });
  }

  return (
    <SettingsSection
      title="Appearance schedule"
      note={<>On each reader&rsquo;s own clock</>}
    >
      <div className={styles.scheduleRow}>
        <input
          key={themeSwitchoverAt ?? "unset"}
          className={styles.timeInput}
          type="time"
          defaultValue={themeSwitchoverAt ?? ""}
          aria-label="Switchover time"
          disabled={busy !== null}
          onChange={(event) => commitSwitchover(event.target.value)}
        />
        <select
          className={styles.select}
          value={themeSwitchoverTo}
          aria-label="Appearance after the switchover"
          disabled={busy !== null}
          onChange={(event) =>
            void save({ themeSwitchoverTo: event.target.value as Appearance })
          }
        >
          <option value="dark">turns dark</option>
          <option value="light">turns light</option>
        </select>
        {themeSwitchoverAt ? (
          <SettingsButton
            type="button"
            disabled={busy !== null}
            onClick={() => commitSwitchover("")}
          >
            Clear
          </SettingsButton>
        ) : null}
      </div>
      <SettingsNote>
        {themeSwitchoverAt
          ? `${themeSwitchoverAt} until midnight is ${themeSwitchoverTo}; the rest of the day is ${themeSwitchoverTo === "dark" ? "light" : "dark"}. A reader who presses the theme toggle keeps their own choice from then on.`
          : "No schedule. Readers follow their operating system until they choose otherwise."}
      </SettingsNote>
    </SettingsSection>
  );
}
