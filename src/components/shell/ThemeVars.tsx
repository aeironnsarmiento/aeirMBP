import {
  GLASS_OPACITY_MAX,
  GLASS_OPACITY_MIN,
  type SiteSettings,
} from "@/lib/site/schema";

/**
 * Publishes the owner's glass opacity onto the document root (R15).
 *
 * Two values, not one: the frame and the panes inside it are independently
 * tunable (R14). Nothing reads them in JavaScript — the `data-blur` attribute
 * GlassSurface already writes is what selects between them in CSS.
 *
 * It goes on `:root` because the tokens are read by rules across the whole
 * document, not by a subtree. Server-rendered so the correct opacity is in the
 * first paint — a style applied after hydration would show one frame of the
 * default.
 */
function clampOpacity(value: unknown): number {
  return Math.min(
    GLASS_OPACITY_MAX,
    Math.max(GLASS_OPACITY_MIN, Number(value) || 0.55),
  );
}

export function ThemeVars({ settings }: { settings: SiteSettings }) {
  // Validated on write, but interpolated into a stylesheet here, so coerced
  // and clamped again rather than trusted twice.
  const frame = clampOpacity(settings.frameOpacity);
  const pane = clampOpacity(settings.paneOpacity);

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `:root{--glass-alpha-frame:${frame.toFixed(3)};--glass-alpha-pane:${pane.toFixed(3)}}`,
      }}
    />
  );
}
