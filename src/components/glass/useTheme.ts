"use client";

import { switchoverMinutes } from "@/lib/site/schema";
import {
  THEME_COLORS,
  THEME_COLOR_ID,
  THEME_SCHEDULE_ATTRIBUTE,
  THEME_STORAGE_KEY,
  isTheme,
  otherTheme,
  parseSchedule,
  type Theme,
  type ThemeSchedule,
} from "./themeContract";

export {
  APPEARANCES,
  THEME_COLORS,
  THEME_COLOR_ID,
  THEME_SCHEDULE_ATTRIBUTE,
  THEME_STORAGE_KEY,
  isTheme,
  otherTheme,
  parseSchedule,
  serialiseSchedule,
  themeBootScript,
  type Theme,
  type ThemeSchedule,
} from "./themeContract";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function resolveSystemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function readSchedule(): ThemeSchedule | null {
  if (typeof document === "undefined") return null;
  return parseSchedule(
    document.documentElement.dataset[THEME_SCHEDULE_ATTRIBUTE],
  );
}

export function scheduledTheme(schedule: ThemeSchedule, now: Date): Theme {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= switchoverMinutes(schedule.at)
    ? schedule.to
    : otherTheme(schedule.to);
}

export function resolveThemeAttribute(
  schedule: ThemeSchedule | null = readSchedule(),
  now: Date = new Date(),
): Theme | null {
  const stored = readStoredTheme();
  if (stored) return stored;
  if (schedule) return scheduledTheme(schedule, now);
  return null;
}

export function resolveTheme(
  schedule: ThemeSchedule | null = readSchedule(),
  now: Date = new Date(),
): Theme {
  return resolveThemeAttribute(schedule, now) ?? resolveSystemTheme();
}

export function currentTheme(): Theme {
  if (typeof document === "undefined") return resolveSystemTheme();
  const applied = document.documentElement.dataset.theme;
  return isTheme(applied) ? applied : resolveSystemTheme();
}

function applyBrowserChrome(theme: Theme | null): void {
  const head = document.head;
  if (!head) return;

  const existing = document.getElementById(
    THEME_COLOR_ID,
  ) as HTMLMetaElement | null;

  if (theme === null) {
    existing?.remove();
    return;
  }

  const meta = existing ?? document.createElement("meta");
  if (!existing) {
    meta.id = THEME_COLOR_ID;
    meta.name = "theme-color";
    head.prepend(meta);
  }
  meta.content = THEME_COLORS[theme];
}

export function applyTheme(theme: Theme | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === null) {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
  applyBrowserChrome(theme);
}

export function setTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
  }
  applyTheme(theme);
}

export function toggleTheme(): Theme {
  const next = otherTheme(currentTheme());
  setTheme(next);
  return next;
}

let pendingWrite: { value: Theme | null } | null = null;

export function clearPendingThemeWrite(): void {
  pendingWrite = null;
  held = false;
}

let held = false;

export function holdScheduledTheme(hold: boolean): void {
  held = hold;
}

export function recomputeTheme({
  schedule = readSchedule(),
  now = new Date(),
  defer = (write: () => void) => write(),
}: {
  schedule?: ThemeSchedule | null;
  now?: Date;
  defer?: (write: () => void) => void;
} = {}): boolean {
  if (typeof document === "undefined" || held) return false;

  const next = resolveThemeAttribute(schedule, now);
  const settled = pendingWrite
    ? pendingWrite.value
    : ((document.documentElement.dataset.theme as Theme | undefined) ?? null);

  if (settled === next) return false;

  pendingWrite = { value: next };

  defer(() => {
    const write = pendingWrite;
    pendingWrite = null;
    if (write) applyTheme(write.value);
  });

  return true;
}
