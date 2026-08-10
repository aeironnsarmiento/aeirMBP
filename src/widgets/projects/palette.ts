import { hueFor } from "@/widgets/music/format";
import type { Project } from "./data";

export type SwatchStops = {
  from: string;
  to: string;
};

export function swatchStops(project: Project): SwatchStops {
  if (project.palette) {
    return { from: project.palette.surface, to: project.palette.accent };
  }

  const hue = hueFor(project.id);
  return {
    from: `oklch(0.7 0.12 ${hue})`,
    to: `oklch(0.48 0.14 ${hue + 55})`,
  };
}

export function swatchStyle(project: Project): React.CSSProperties {
  const { from, to } = swatchStops(project);
  return { "--swatch-from": from, "--swatch-to": to } as React.CSSProperties;
}
