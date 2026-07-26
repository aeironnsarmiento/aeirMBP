import type { WidgetManifest } from "@/lib/registry/types";
import { MusicCompact } from "./compact";
import { MusicExpanded } from "./expanded";
import { MusicIcon } from "./icon";

export const musicManifest: WidgetManifest = {
  id: "music",
  title: "Music",
  tagline: "What I have been listening to, from my own store",
  hotkey: "m",
  order: 2,
  span: "two",
  icon: MusicIcon,
  compact: MusicCompact,
  expanded: MusicExpanded,
  subViews: [
    { id: "recent", label: "Recently played" },
    { id: "artists", label: "Top artists" },
    { id: "albums", label: "Top albums" },
    { id: "tracks", label: "Top tracks" },
  ],
};
