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

function clampOpacity(value: unknown): number {
  return Math.min(
    GLASS_OPACITY_MAX,
    Math.max(GLASS_OPACITY_MIN, Number(value) || 0.55),
  );
}

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
  const frame = clampOpacity(settings.frameOpacity);
  const pane = clampOpacity(settings.paneOpacity);

  const light = backgroundForAppearance("light", backgrounds);
  const dark = backgroundForAppearance("dark", backgrounds);

  const isVideo =
    !hasBackgroundPair(backgrounds) &&
    (light.kind === "video" || dark.kind === "video");

  const layers = isVideo
    ? ""
    : [
        `:root{--bg-image:${cssUrl(light.src)}}`,
        `@media (prefers-color-scheme:dark){:root{--bg-image:${cssUrl(dark.src)}}}`,
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
      <script dangerouslySetInnerHTML={{ __html: themeBootScript(schedule) }} />
    </>
  );
}
