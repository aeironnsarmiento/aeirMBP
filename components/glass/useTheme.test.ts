import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  readStoredTheme,
  resolveSystemTheme,
  resolveTheme,
  setTheme,
  toggleTheme,
} from "./useTheme";

/** jsdom ships no matchMedia, so the OS preference is stubbed per test. */
function stubSystemTheme(prefersDark: boolean) {
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("dark") ? prefersDark : false,
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      addListener: (fn: () => void) => listeners.add(fn),
      removeListener: (fn: () => void) => listeners.delete(fn),
      dispatchEvent: () => false,
      onchange: null,
    })),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("theme resolution", () => {
  it("resolves to light for a first-time visitor whose OS is light (AE1)", () => {
    stubSystemTheme(false);

    expect(readStoredTheme()).toBeNull();
    expect(resolveSystemTheme()).toBe("light");
    expect(resolveTheme()).toBe("light");
  });

  it("resolves to dark for a first-time visitor whose OS is dark", () => {
    stubSystemTheme(true);

    expect(readStoredTheme()).toBeNull();
    expect(resolveTheme()).toBe("dark");
  });

  it("prefers a stored choice over the OS setting in both directions", () => {
    stubSystemTheme(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(resolveTheme()).toBe("light");

    stubSystemTheme(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(resolveTheme()).toBe("dark");
  });

  it("ignores a stored value that is not a known theme", () => {
    stubSystemTheme(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");

    expect(readStoredTheme()).toBeNull();
    expect(resolveTheme()).toBe("light");
  });
});

describe("applying a theme", () => {
  it("writes localStorage and pins the root attribute that drives the tokens", () => {
    stubSystemTheme(false);

    setTheme("dark");

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("toggles from the currently resolved theme and returns the new one", () => {
    stubSystemTheme(true);

    expect(toggleTheme()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    expect(toggleTheme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("leaves the media query in charge when no choice is stored", () => {
    stubSystemTheme(true);

    applyTheme(null);

    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

});
