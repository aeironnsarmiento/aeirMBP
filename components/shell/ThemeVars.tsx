import {
  GLASS_OPACITY_MAX,
  GLASS_OPACITY_MIN,
  type SiteSettings,
} from "@/lib/site/schema";

/**
 * Publishes the owner's glass opacity onto the document root.
 *
 * It has to be `:root` rather than a wrapper element: the expanded-widget
 * modal portals to `document.body`, outside any wrapper, and would otherwise
 * miss the value entirely.
 *
 * Server-rendered so the correct opacity is in the first paint — a style
 * applied after hydration would show one frame of the default (R11).
 */
export function ThemeVars({ settings }: { settings: SiteSettings }) {
  // The value is validated on write, but it is interpolated into a stylesheet,
  // so it is coerced and clamped here too rather than trusted twice.
  const alpha = Math.min(
    GLASS_OPACITY_MAX,
    Math.max(GLASS_OPACITY_MIN, Number(settings.glassOpacity) || 0.55),
  );

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `:root{--glass-alpha:${alpha.toFixed(3)}}`,
      }}
    />
  );
}
