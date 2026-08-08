import { aboutManifest } from "@/widgets/about/manifest";
import { musicManifest } from "@/widgets/music/manifest";
import { projectsManifest } from "@/widgets/projects/manifest";
import { settingsManifest } from "@/widgets/settings/manifest";
import { assembleRegistry } from "./assemble";

export const REGISTRY = assembleRegistry([
  aboutManifest,
  musicManifest,
  projectsManifest,
  settingsManifest,
]);

export * from "./assemble";
export * from "./types";
