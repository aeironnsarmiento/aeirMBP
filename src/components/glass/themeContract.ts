export type Theme = "light" | "dark";

export const APPEARANCES = ["light", "dark"] as const;

export const THEME_STORAGE_KEY = "xen-theme";

export const THEME_SCHEDULE_ATTRIBUTE = "themeSchedule";

export const THEME_COLOR_ID = "xen-theme-color";

export const THEME_COLORS: Record<Theme, string> = {
  light: "#e9edf5",
  dark: "#12161f",
};

export type ThemeSchedule = {
  at: string;
  to: Theme;
};

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

export function otherTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

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

export function themeBootScript(schedule: ThemeSchedule | null): string {
  const key = JSON.stringify(THEME_STORAGE_KEY);
  const serialised = JSON.stringify(schedule ? serialiseSchedule(schedule) : "");
  const colours = JSON.stringify(THEME_COLORS);
  const id = JSON.stringify(THEME_COLOR_ID);

  return `(function(){try{var r=document.documentElement;var s=${serialised};if(s){r.dataset.themeSchedule=s}var t=localStorage.getItem(${key});if(t!=="light"&&t!=="dark"){t=null}if(!t&&s){var p=s.split("|");var m=new Date();var n=m.getHours()*60+m.getMinutes();var b=parseInt(p[0].slice(0,2),10)*60+parseInt(p[0].slice(3,5),10);t=n>=b?p[1]:(p[1]==="dark"?"light":"dark")}if(t){r.dataset.theme=t;var c=document.createElement("meta");c.id=${id};c.name="theme-color";c.content=(${colours})[t];document.head.prepend(c)}}catch(e){}})();`;
}
