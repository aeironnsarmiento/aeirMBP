import type { WidgetManifest } from "@/lib/registry/types";
import { AboutCompact } from "./compact";
import { AboutExpanded } from "./expanded";
import { AboutIcon } from "./icon";

export const aboutManifest: WidgetManifest = {
  id: "about",
  title: "About",
  hotkey: "a",
  order: 1,
  icon: AboutIcon,
  compact: AboutCompact,
  expanded: AboutExpanded,
  /** The site's main display: expanded on first load (R4). */
  openByDefault: true,
};
