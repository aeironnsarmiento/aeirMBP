"use client";

import { useRouter } from "next/navigation";
import { useSite } from "@/components/shell/SiteContext";
import { AccountSection } from "@/widgets/settings/sections/AccountSection";
import { AppearanceScheduleSection } from "@/widgets/settings/sections/AppearanceScheduleSection/AppearanceScheduleSection";
import { AvatarSection } from "@/widgets/settings/sections/AvatarSection/AvatarSection";
import { BackgroundSection } from "@/widgets/settings/sections/BackgroundSection/BackgroundSection";
import { GlassOpacitySection } from "@/widgets/settings/sections/GlassOpacitySection/GlassOpacitySection";
import { ListeningDataSection } from "@/widgets/settings/sections/ListeningDataSection/ListeningDataSection";
import { StorageSection } from "@/widgets/settings/sections/StorageSection";
import { usePendingAsset } from "@/widgets/settings/usePendingAsset";
import { useSettingsActivity } from "@/widgets/settings/useSettingsActivity";
import styles from "./expanded.module.css";

export function SettingsExpanded() {
  const router = useRouter();
  const { settings, avatarUrl, backgrounds } = useSite();
  const { busy, status, beginActivity, reportActivity, endActivity } =
    useSettingsActivity();
  const {
    pendingAsset: pending,
    selectPendingAsset,
    clearPendingAsset,
  } = usePendingAsset();

  return (
    <div className={styles.panel}>
      <BackgroundSection
        settings={settings}
        backgrounds={backgrounds}
        busy={busy}
        pendingAsset={pending}
        beginActivity={beginActivity}
        reportActivity={reportActivity}
        endActivity={endActivity}
        selectPendingAsset={selectPendingAsset}
        clearPendingAsset={clearPendingAsset}
        refresh={() => router.refresh()}
      />

      <AppearanceScheduleSection
        themeSwitchoverAt={settings.themeSwitchoverAt}
        themeSwitchoverTo={settings.themeSwitchoverTo}
        busy={busy}
        beginActivity={beginActivity}
        reportActivity={reportActivity}
        endActivity={endActivity}
        refresh={() => router.refresh()}
      />

      <GlassOpacitySection
        frameOpacity={settings.frameOpacity}
        paneOpacity={settings.paneOpacity}
        busy={busy}
        beginActivity={beginActivity}
        reportActivity={reportActivity}
        endActivity={endActivity}
        refresh={() => router.refresh()}
      />

      <AvatarSection
        avatarUrl={avatarUrl}
        busy={busy}
        pendingAsset={pending}
        beginActivity={beginActivity}
        reportActivity={reportActivity}
        endActivity={endActivity}
        selectPendingAsset={selectPendingAsset}
        clearPendingAsset={clearPendingAsset}
        refresh={() => router.refresh()}
      />

      <StorageSection
        busy={busy}
        beginActivity={beginActivity}
        reportActivity={reportActivity}
        endActivity={endActivity}
      />

      <ListeningDataSection
        busy={busy}
        beginActivity={beginActivity}
        reportActivity={reportActivity}
        endActivity={endActivity}
      />

      <AccountSection status={status} refresh={() => router.refresh()} />
    </div>
  );
}
