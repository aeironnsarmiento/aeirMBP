import { BLUR_DEPTH_CEILING } from "./GlassSurface";

/**
 * Audits a rendered tree against the blur-layer ceiling (R6).
 *
 * Every glass surface writes `data-blur` and `data-glass-depth`, so the bound
 * is checkable from the DOM rather than by reading the component tree. Used by
 * the U15 tests, and usable from the browser console on a real device:
 *
 *     copy(auditBlurLayers(document))
 */
export type BlurAudit = {
  /** Surfaces that actually carry a backdrop filter. */
  blurred: number;
  /** Surfaces past the ceiling, rendering without one. */
  suppressed: number;
  /** Deepest nesting reached by any glass surface. */
  maxDepth: number;
  /** True when no surface carries a backdrop filter past the ceiling. */
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
