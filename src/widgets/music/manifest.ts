import type { WidgetManifest } from "@/lib/registry/types";
import { MusicCompact } from "./compact/compact";
import { MusicExpanded } from "./expanded/expanded";
import { MusicIcon } from "./icon";

export const musicManifest: WidgetManifest = {
  id: "music",
  title: "Music",
  hotkey: "m",
  order: 2,
  span: "two",
  icon: MusicIcon,
  compact: MusicCompact,
  expanded: MusicExpanded,
  subViews: [
    { id: "tracks", label: "Top tracks" },
    { id: "artists", label: "Top artists" },
    { id: "albums", label: "Top albums" },
    { id: "recent", label: "Recently played" },
  ],
  defaultSubView: "recent",
};
