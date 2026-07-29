import {
  themeBootScript,
  type ThemeSchedule,
} from "@/components/glass/themeContract";
import {
  GLASS_OPACITY_MAX,
  GLASS_OPACITY_MIN,
  isSwitchoverTime,
  type SiteSettings,
} from "@/lib/site/schema";
import {
  backgroundForAppearance,
  hasBackgroundPair,
  type BackgroundSlots,
} from "@/lib/theme/backgrounds";

/**
 * Publishes the owner's appearance before the shell parses (R13, R15).
 *
 * The wallpaper is a theme token, not React state, emitted into all three
 * cascade layers so the resolved appearance selects it by specificity — no
 * fetch at the switchover, no way for theme and wallpaper to disagree. All
 * three, because a reader with no choice and no schedule gets no `data-theme`
 * at all and reaches the wallpaper through the media query (R12, AE4).
 *
 * The script beside it is the only pre-hydration writer of that attribute.
 * Rendered from the page, not the layout: it reads request state, and the
 * layout wraps the built-in not-found response.
 */
function clampOpacity(value: unknown): number {
  return Math.min(
    GLASS_OPACITY_MAX,
    Math.max(GLASS_OPACITY_MIN, Number(value) || 0.55),
  );
}

/** RFC 3986's character set and nothing else. Re-checked rather than trusted
 *  twice: a quote, backslash, newline or angle bracket ends the style early. */
const SAFE_URL = /^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/;

function cssUrl(src: string): string {
  return SAFE_URL.test(src) ? `url("${src}")` : "none";
}

export function ThemeVars({
  settings,
  backgrounds,
}: {
  settings: SiteSettings;
  backgrounds: BackgroundSlots;
}) {
  // Validated on write, but interpolated into a stylesheet here, so coerced
  // and clamped again rather than trusted twice.
  const frame = clampOpacity(settings.frameOpacity);
  const pane = clampOpacity(settings.paneOpacity);

  const light = backgroundForAppearance("light", backgrounds);
  const dark = backgroundForAppearance("dark", backgrounds);

  // A video is an element, not a background-image, and only ever the single
  // background — so it publishes no property and the shell renders a <video>.
  const isVideo =
    !hasBackgroundPair(backgrounds) &&
    (light.kind === "video" || dark.kind === "video");

  const layers = isVideo
    ? ""
    : [
        // 1. The bare root, which is also the light layer.
        `:root{--bg-image:${cssUrl(light.src)}}`,
        // 2. The OS preference, for the reader who carries no attribute.
        `@media (prefers-color-scheme:dark){:root{--bg-image:${cssUrl(dark.src)}}}`,
        // 3. The explicit appearance, however it was resolved.
        `:root[data-theme="light"]{--bg-image:${cssUrl(light.src)}}`,
        `:root[data-theme="dark"]{--bg-image:${cssUrl(dark.src)}}`,
      ].join("");

  const schedule: ThemeSchedule | null = isSwitchoverTime(
    settings.themeSwitchoverAt,
  )
    ? { at: settings.themeSwitchoverAt, to: settings.themeSwitchoverTo }
    : null;

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `:root{--glass-alpha-frame:${frame.toFixed(3)};--glass-alpha-pane:${pane.toFixed(3)}}${layers}`,
        }}
      />
      {/* Blocking and inline, so no reader sees a frame of the wrong theme
          or the wrong wallpaper (R13, AE8). */}
      <script dangerouslySetInnerHTML={{ __html: themeBootScript(schedule) }} />
    </>
  );
}
