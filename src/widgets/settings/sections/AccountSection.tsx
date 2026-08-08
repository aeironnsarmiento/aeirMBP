"use client";

import type { SettingsActivityStatus } from "@/widgets/settings/useSettingsActivity";
import {
  SettingsActions,
  SettingsButton,
  SettingsStatus,
} from "../components/SettingsActions/SettingsActions";
import { SettingsSection } from "../components/SettingsSection/SettingsSection";

export type AccountSectionProps = {
  status: SettingsActivityStatus;
  refresh: () => void;
};

export function AccountSection({ status, refresh }: AccountSectionProps) {
  return (
    <SettingsSection>
      <SettingsActions>
        <SettingsButton
          type="button"
          onClick={async () => {
            await fetch("/api/auth", { method: "DELETE" });
            refresh();
          }}
        >
          Sign out
        </SettingsButton>
        {status ? (
          <SettingsStatus tone={status.tone}>{status.message}</SettingsStatus>
        ) : null}
      </SettingsActions>
    </SettingsSection>
  );
}
