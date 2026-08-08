"use client";

import { useState } from "react";
import type { StorageCheck } from "@/lib/site/storage";
import { failureMessage } from "@/widgets/settings/http/rejection";
import type {
  SettingsActivityKey,
  SettingsActivityStatus,
} from "@/widgets/settings/useSettingsActivity";
import {
  SettingsActions,
  SettingsButton,
} from "../components/SettingsActions/SettingsActions";
import { SettingsSection } from "../components/SettingsSection/SettingsSection";

export type StorageSectionProps = {
  busy: SettingsActivityKey | null;
  beginActivity: (key: SettingsActivityKey) => void;
  reportActivity: (result: SettingsActivityStatus) => void;
  endActivity: () => void;
};

export function StorageSection({
  busy,
  beginActivity,
  reportActivity,
  endActivity,
}: StorageSectionProps) {
  const [storage, setStorage] = useState<StorageCheck | null>(null);

  async function storageAction(mode: "check" | "repair") {
    beginActivity("storage");
    try {
      const response = await fetch("/api/settings/storage", {
        method: mode === "check" ? "GET" : "POST",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await failureMessage(response));
      const body = (await response.json()) as StorageCheck;

      setStorage(body);
      reportActivity({ tone: body.ok ? "ok" : "error", message: body.message });
    } catch (error) {
      setStorage(null);
      reportActivity({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Could not check storage.",
      });
    } finally {
      endActivity();
    }
  }

  return (
    <SettingsSection title="Storage" note="Where avatars and backgrounds live">
      <SettingsActions>
        <SettingsButton
          type="button"
          disabled={busy !== null}
          onClick={() => void storageAction("check")}
        >
          {busy === "storage" ? "Checking…" : "Check storage"}
        </SettingsButton>
        {storage && !storage.ok && storage.fault !== "credential" ? (
          <SettingsButton
            type="button"
            disabled={busy !== null}
            onClick={() => void storageAction("repair")}
          >
            {storage.fault === "bucket" ? "Create the bucket" : "Fix the bucket"}
          </SettingsButton>
        ) : null}
      </SettingsActions>
    </SettingsSection>
  );
}
