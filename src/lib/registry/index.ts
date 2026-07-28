import { aboutManifest } from "@/widgets/about/manifest";
import { musicManifest } from "@/widgets/music/manifest";
import { projectsManifest } from "@/widgets/projects/manifest";
import { settingsManifest } from "@/widgets/settings/manifest";
import { assembleRegistry } from "./assemble";

/**
 * The registry.
 *
 * The only place in the codebase where a widget is named. The shell renders
 * navigation and the grid by iterating this list, never by referencing a
 * widget individually (R14) — which is what makes adding a fifth widget one
 * directory and one line here, with no shell change.
 */
export const REGISTRY = assembleRegistry([
  aboutManifest,
  musicManifest,
  projectsManifest,
  settingsManifest,
]);

export * from "./assemble";
export * from "./types";
