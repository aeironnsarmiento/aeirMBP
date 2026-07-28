"use client";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "xen-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * The visitor's explicit choice, or null when they have never expressed one.
 * A null result is meaningful: it is what keeps the `prefers-color-scheme`
 * media query live, so a mid-session OS change is still followed (R9).
 */
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

/** Stored preference wins; otherwise the operating system decides. */
export function resolveTheme(): Theme {
  return readStoredTheme() ?? resolveSystemTheme();
}

/**
 * Writes the resolved theme onto the document root.
 *
 * Passing null removes the attribute, handing control back to the media query.
 * No component re-renders as a result of this call — the custom property
 * values resolved from :root change, and the paint follows (R11).
 */
export function applyTheme(theme: Theme | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === null) {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}

export function setTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable — the choice still applies for this page view.
  }
  applyTheme(theme);
}

export function toggleTheme(): Theme {
  const next: Theme = resolveTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

/**
 * Runs before first paint, ahead of hydration, to pin an explicit choice onto
 * the root element. It deliberately writes nothing when no choice is stored,
 * leaving the media query in charge.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}})();`;
