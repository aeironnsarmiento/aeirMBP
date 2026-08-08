import type { WidgetManifest } from "@/lib/registry/types";
import { AboutCompact } from "./compact/compact";
import { AboutExpanded } from "./expanded/expanded";
import { AboutIcon } from "./icon";

export const aboutManifest: WidgetManifest = {
  id: "about",
  title: "About",
  hotkey: "a",
  order: 1,
  icon: AboutIcon,
  compact: AboutCompact,
  expanded: AboutExpanded,
  openByDefault: true,
};
