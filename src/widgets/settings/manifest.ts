import type { WidgetManifest } from "@/lib/registry/types";
import { SettingsCompact } from "./compact";
import { SettingsExpanded } from "./expanded";
import { SettingsIcon } from "./icon";

export const settingsManifest: WidgetManifest = {
  id: "settings",
  title: "Settings",
  tagline: "Background, glass, avatar, listening data",
  hotkey: "s",
  order: 9,
  icon: SettingsIcon,
  compact: SettingsCompact,
  expanded: SettingsExpanded,
  /** Removed from the registry entirely for an unauthenticated caller (R16). */
  adminOnly: true,
};
