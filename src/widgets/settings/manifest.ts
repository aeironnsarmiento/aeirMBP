import type { WidgetManifest } from "@/lib/registry/types";
import { SettingsCompact } from "./compact/compact";
import { SettingsExpanded } from "./expanded/expanded";
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
  adminOnly: true,
};
