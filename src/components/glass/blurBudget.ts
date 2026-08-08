import { BLUR_DEPTH_CEILING } from "./GlassSurface";

export type BlurAudit = {
  blurred: number;
  suppressed: number;
  maxDepth: number;
  withinBudget: boolean;
  violations: Array<{ depth: number; classes: string }>;
};

export function auditBlurLayers(root: ParentNode): BlurAudit {
  const surfaces = [...root.querySelectorAll<HTMLElement>("[data-glass-depth]")];

  let blurred = 0;
  let suppressed = 0;
  let maxDepth = 0;
  const violations: BlurAudit["violations"] = [];

  for (const surface of surfaces) {
    const depth = Number(surface.dataset.glassDepth ?? 0);
    maxDepth = Math.max(maxDepth, depth);

    if (surface.dataset.blur === "on") {
      blurred += 1;
      if (depth > BLUR_DEPTH_CEILING) {
        violations.push({ depth, classes: surface.className });
      }
    } else {
      suppressed += 1;
    }
  }

  return {
    blurred,
    suppressed,
    maxDepth,
    withinBudget: violations.length === 0,
    violations,
  };
}
