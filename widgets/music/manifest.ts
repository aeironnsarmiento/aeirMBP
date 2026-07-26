import type { WidgetManifest } from "@/lib/registry/types";
import { MusicCompact } from "./compact";
import { MusicExpanded } from "./expanded";
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
  // The three tallies read together on the top row; the feed sits under them.
  subViews: [
    { id: "tracks", label: "Top tracks" },
    { id: "artists", label: "Top artists" },
    { id: "albums", label: "Top albums" },
    { id: "recent", label: "Recently played" },
  ],
  defaultSubView: "recent",
};
