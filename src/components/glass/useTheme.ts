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

// Re-exported so client callers keep one import. Anything the server also
// needs must stay in ./themeContract — see its header for why.
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

/** Null is meaningful: it lets the schedule, then the media query, decide
 *  instead (R11, R12). */
export function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    // Private browsing or a blocked storage partition. Fall back to the OS.
    return null;
  }
}

export function resolveSystemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/** The schedule the pre-paint script published, if the owner set one. */
export function readSchedule(): ThemeSchedule | null {
  if (typeof document === "undefined") return null;
  return parseSchedule(
    document.documentElement.dataset[THEME_SCHEDULE_ATTRIBUTE],
  );
}

/**
 * Which side of the switchover a clock reading falls on, against the reader's
 * own clock (R9, R10). `>=` not `>`: the recompute runs several times inside
 * the boundary minute, and `>` flickers across them.
 */
export function scheduledTheme(schedule: ThemeSchedule, now: Date): Theme {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= switchoverMinutes(schedule.at)
    ? schedule.to
    : otherTheme(schedule.to);
}

/**
 * What to write onto the root, or null to write nothing. Null is the R12
 * state — no choice, no schedule — where the media query stays live and a
 * mid-session OS change is followed with no JavaScript. The schedule is a
 * better default than the OS, never an override of a stated preference (R11).
 */
export function resolveThemeAttribute(
  schedule: ThemeSchedule | null = readSchedule(),
  now: Date = new Date(),
): Theme | null {
  const stored = readStoredTheme();
  if (stored) return stored;
  if (schedule) return scheduledTheme(schedule, now);
  return null;
}

/** The appearance a reader actually ends up looking at. */
export function resolveTheme(
  schedule: ThemeSchedule | null = readSchedule(),
  now: Date = new Date(),
): Theme {
  return resolveThemeAttribute(schedule, now) ?? resolveSystemTheme();
}

/** Reads the applied attribute rather than recomputing — a reader whose dark
 *  came from the schedule is looking at dark, and one press must give light. */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return resolveSystemTheme();
  const applied = document.documentElement.dataset.theme;
  return isTheme(applied) ? applied : resolveSystemTheme();
}

/**
 * Paints the mobile browser's chrome to match (R17). Inside the apply step so
 * the pre-paint script, the toggle and the recompute all drive it. Prepended
 * because the first *matching* `theme-color` wins and the layout's pair is
 * media-scoped; null hands the phone back to that pair (R12).
 */
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

/** Null removes the attribute, handing control back to the media query. No
 *  component re-renders — the :root custom properties change (R11). */
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
    // Storage unavailable — the choice still applies for this page view.
  }
  applyTheme(theme);
}

/**
 * Inverts what is on screen and pins it (R11, R14). Not `resolveTheme()`
 * inverted — a dark-OS reader in a light scheduled window would then invert
 * the OS and pin the appearance they were already looking at.
 */
export function toggleTheme(): Theme {
  const next = otherTheme(currentTheme());
  setTheme(next);
  return next;
}

/** Module-level: "exactly one write lands" is a property of the document, not
 *  of whichever tick noticed the boundary first. */
let pendingWrite: { value: Theme | null } | null = null;

/** Test seam, mirroring `clearPendingTransitions`. Not called by the shell. */
export function clearPendingThemeWrite(): void {
  pendingWrite = null;
  held = false;
}

/** Suspends the schedule while the settings preview is up (R16) — a
 *  switchover firing underneath reads as the preview failing on its own. */
let held = false;

export function holdScheduledTheme(hold: boolean): void {
  held = hold;
}

/**
 * Re-resolves against the wall clock and applies (R15). Reading the clock, not
 * arming a timer: a timer measures elapsed time and mis-fires on DST, sleep
 * and timezone changes. No-ops are dropped here at the source, compared
 * against any write already waiting, so a boundary noticed twice inside one
 * transition still lands once. Returns whether a write was scheduled.
 */
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
