/**
 * Theme values both sides of the client boundary need.
 *
 * No `"use client"` directive, deliberately: `ThemeVars` is a server component
 * that *calls* the boot-script generator, and calling an export from a
 * `"use client"` module there is a runtime 500 that typecheck, lint, build and
 * the suite all pass. Anything touching `window` or `document` goes in
 * `useTheme` instead, which re-exports this for the client.
 */

export type Theme = "light" | "dark";

export const APPEARANCES = ["light", "dark"] as const;

export const THEME_STORAGE_KEY = "xen-theme";

/** Published onto the root by the pre-paint script, so the toggle and the
 *  recompute read one copy. An attribute, so it is inspectable. */
export const THEME_SCHEDULE_ATTRIBUTE = "themeSchedule";

/** The `theme-color` meta this app owns. Never the ones the layout renders. */
export const THEME_COLOR_ID = "xen-theme-color";

/** The mobile browser's chrome colour (R17). Matches the page background at
 *  each end of the cascade in `globals.css`; drift shows as a hairline. */
export const THEME_COLORS: Record<Theme, string> = {
  light: "#e9edf5",
  dark: "#12161f",
};

export type ThemeSchedule = {
  /** `HH:MM` on the reader's own clock (R10). */
  at: string;
  /** The appearance from that time until midnight. Before it, the other one. */
  to: Theme;
};

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

export function otherTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/** `19:00|dark`. Parsed in two places, so it is spelled in one. */
export function serialiseSchedule(schedule: ThemeSchedule): string {
  return `${schedule.at}|${schedule.to}`;
}

export function parseSchedule(
  value: string | undefined | null,
): ThemeSchedule | null {
  if (!value) return null;
  const [at, to] = value.split("|");
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(at ?? "")) return null;
  return isTheme(to) ? { at, to } : null;
}

/**
 * Runs before first paint. Writes nothing without a stored choice or a
 * schedule, leaving the media query in charge (R12). Publishes the schedule
 * and paints the address bar here too (R17) — hydration is too late, since by
 * then the resolved value is applied and the recompute drops no-ops.
 *
 * Duplicates `resolveThemeAttribute`'s rule in minified form, because a
 * pre-paint script cannot import. A test runs this and compares the two.
 */
export function themeBootScript(schedule: ThemeSchedule | null): string {
  const key = JSON.stringify(THEME_STORAGE_KEY);
  const serialised = JSON.stringify(schedule ? serialiseSchedule(schedule) : "");
  const colours = JSON.stringify(THEME_COLORS);
  const id = JSON.stringify(THEME_COLOR_ID);

  return `(function(){try{var r=document.documentElement;var s=${serialised};if(s){r.dataset.themeSchedule=s}var t=localStorage.getItem(${key});if(t!=="light"&&t!=="dark"){t=null}if(!t&&s){var p=s.split("|");var m=new Date();var n=m.getHours()*60+m.getMinutes();var b=parseInt(p[0].slice(0,2),10)*60+parseInt(p[0].slice(3,5),10);t=n>=b?p[1]:(p[1]==="dark"?"light":"dark")}if(t){r.dataset.theme=t;var c=document.createElement("meta");c.id=${id};c.name="theme-color";c.content=(${colours})[t];document.head.prepend(c)}}catch(e){}})();`;
}
