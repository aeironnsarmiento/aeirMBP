import type { WidgetManifest } from "@/lib/registry/types";
import { ProjectsCompact } from "./compact";
import { ProjectsExpanded } from "./expanded";
import { ProjectsIcon } from "./icon";

export const projectsManifest: WidgetManifest = {
  id: "projects",
  title: "Projects",
  tagline: "Things I have built and shipped",
  hotkey: "p",
  order: 3,
  icon: ProjectsIcon,
  compact: ProjectsCompact,
  expanded: ProjectsExpanded,
};
