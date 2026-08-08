import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_COLORS } from "../themeContract";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  clearPendingThemeWrite,
  currentTheme,
  parseSchedule,
  readSchedule,
  readStoredTheme,
  recomputeTheme,
  resolveSystemTheme,
  resolveTheme,
  resolveThemeAttribute,
  scheduledTheme,
  serialiseSchedule,
  setTheme,
  themeBootScript,
  toggleTheme,
  type ThemeSchedule,
} from "../useTheme";

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

/** A clock reading on the reader's own timezone, which is what R10 asks for. */
function at(hours: number, minutes = 0): Date {
  const date = new Date(2026, 6, 28, hours, minutes, 0, 0);
  return date;
}

const EVENING_DARK: ThemeSchedule = { at: "19:00", to: "dark" };
const EVENING_LIGHT: ThemeSchedule = { at: "19:00", to: "light" };

/** What the pre-paint script does, so the toggle sees a real starting state. */
function boot(schedule: ThemeSchedule | null, now: Date) {
  applyTheme(resolveThemeAttribute(schedule, now));
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeSchedule;
  // The boot script prepends one per run, and jsdom keeps one document for the
  // whole file — so left alone they pile up and the next test reads a stale one.
  document.head
    .querySelectorAll("#xen-theme-color")
    .forEach((element) => element.remove());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("theme resolution", () => {
  it("resolves to light for a first-time visitor whose OS is light (AE1)", () => {
    stubSystemTheme(false);

    expect(readStoredTheme()).toBeNull();
    expect(resolveSystemTheme()).toBe("light");
    expect(resolveTheme(null)).toBe("light");
  });

  it("resolves to dark for a first-time visitor whose OS is dark", () => {
    stubSystemTheme(true);

    expect(readStoredTheme()).toBeNull();
    expect(resolveTheme(null)).toBe("dark");
  });

  it("prefers a stored choice over the OS setting in both directions", () => {
    stubSystemTheme(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(resolveTheme(null)).toBe("light");

    stubSystemTheme(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(resolveTheme(null)).toBe("dark");
  });

  it("ignores a stored value that is not a known theme", () => {
    stubSystemTheme(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");

    expect(readStoredTheme()).toBeNull();
    expect(resolveTheme(null)).toBe("light");
  });
});

describe("the schedule sits between the stored choice and the OS (R10, R11, R12)", () => {
  it("resolves dark inside a dark window on a light machine (AE1)", () => {
    stubSystemTheme(false);

    expect(resolveTheme(EVENING_DARK, at(21))).toBe("dark");
    expect(resolveThemeAttribute(EVENING_DARK, at(21))).toBe("dark");
  });

  it("resolves the other appearance before the boundary", () => {
    stubSystemTheme(true);

    expect(resolveTheme(EVENING_DARK, at(9))).toBe("light");
  });

  it("does not apply to a reader who has stated a preference (AE1)", () => {
    stubSystemTheme(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");

    // Before the boundary, after it, and well past it.
    expect(resolveTheme(EVENING_DARK, at(9))).toBe("light");
    expect(resolveTheme(EVENING_DARK, at(19))).toBe("light");
    expect(resolveTheme(EVENING_DARK, at(23, 59))).toBe("light");
  });

  it("writes no attribute when there is neither a choice nor a schedule (R12)", () => {
    stubSystemTheme(true);

    applyTheme(resolveThemeAttribute(null, at(21)));

    expect(document.documentElement.dataset.theme).toBeUndefined();
    // Still resolves to something, so the wallpaper has an appearance to match.
    expect(resolveTheme(null, at(21))).toBe("dark");
  });

  it("follows a mid-session OS change while no attribute is written", () => {
    stubSystemTheme(false);
    expect(resolveTheme(null)).toBe("light");

    stubSystemTheme(true);
    expect(resolveTheme(null)).toBe("dark");
  });

  it("resolves a reading exactly on the boundary deterministically", () => {
    stubSystemTheme(false);

    // Every call inside the boundary minute agrees, so nothing flickers.
    for (const minute of [0, 0, 0]) {
      expect(scheduledTheme(EVENING_DARK, at(19, minute))).toBe("dark");
    }
    expect(scheduledTheme(EVENING_DARK, at(18, 59))).toBe("light");
    expect(scheduledTheme(EVENING_DARK, at(19, 1))).toBe("dark");
  });

  it("evaluates midnight and the last minute of the day", () => {
    expect(scheduledTheme({ at: "00:00", to: "dark" }, at(0, 0))).toBe("dark");
    expect(scheduledTheme(EVENING_DARK, at(23, 59))).toBe("dark");
    expect(scheduledTheme(EVENING_DARK, at(0, 0))).toBe("light");
  });
});

describe("the toggle inverts what is on screen (R14, AE1)", () => {
  it("gives light to a light-OS reader inside a dark scheduled window", () => {
    stubSystemTheme(false);
    boot(EVENING_DARK, at(21));
    expect(document.documentElement.dataset.theme).toBe("dark");

    expect(toggleTheme()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("gives dark to a dark-OS reader inside a light scheduled window", () => {
    stubSystemTheme(true);
    boot(EVENING_LIGHT, at(21));
    expect(document.documentElement.dataset.theme).toBe("light");

    expect(toggleTheme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("keeps the choice across a later boundary crossing (AE1)", () => {
    stubSystemTheme(false);
    boot(EVENING_DARK, at(21));
    toggleTheme();

    // The reader has pinned light. A later evening changes nothing.
    expect(resolveTheme(EVENING_DARK, at(20))).toBe("light");
    expect(resolveThemeAttribute(EVENING_DARK, at(20))).toBe("light");
  });

  it("inverts the OS when nothing is applied, so R12's reader still toggles", () => {
    stubSystemTheme(true);
    boot(null, at(21));
    expect(document.documentElement.dataset.theme).toBeUndefined();

    expect(toggleTheme()).toBe("light");
  });

  it("reports what is on screen rather than what is stored", () => {
    stubSystemTheme(false);
    applyTheme("dark");

    expect(currentTheme()).toBe("dark");
    expect(readStoredTheme()).toBeNull();
  });
});

describe("applying a theme", () => {
  it("writes localStorage and pins the root attribute that drives the tokens", () => {
    stubSystemTheme(false);

    setTheme("dark");

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("leaves the media query in charge when no choice is stored", () => {
    stubSystemTheme(true);

    applyTheme(null);

    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("does not throw when storage is unavailable, and still applies", () => {
    stubSystemTheme(false);
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage partition blocked");
      });

    expect(() => setTheme("dark")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");

    setItem.mockRestore();
  });
});

describe("the published schedule", () => {
  it("round-trips through the root attribute", () => {
    document.documentElement.dataset.themeSchedule =
      serialiseSchedule(EVENING_DARK);

    expect(readSchedule()).toEqual(EVENING_DARK);
  });

  it("reads as absent when nothing was published", () => {
    expect(readSchedule()).toBeNull();
  });

  it("refuses a malformed published value rather than half-parsing it", () => {
    for (const value of ["", "19:00", "25:00|dark", "19:00|sepia", "nonsense"]) {
      expect(parseSchedule(value)).toBeNull();
    }
  });
});

describe("the pre-paint script agrees with the module", () => {
  /** Runs the emitted source the way the browser would, before hydration. */
  function run(script: string) {
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.themeSchedule;
    new Function(script)();
  }

  it("resolves every combination the same way resolveThemeAttribute does", () => {
    stubSystemTheme(false);
    vi.setSystemTime(at(21));

    for (const schedule of [null, EVENING_DARK, EVENING_LIGHT]) {
      for (const stored of [null, "light", "dark"] as const) {
        window.localStorage.clear();
        if (stored) window.localStorage.setItem(THEME_STORAGE_KEY, stored);

        run(themeBootScript(schedule));

        expect(document.documentElement.dataset.theme).toBe(
          resolveThemeAttribute(schedule, at(21)) ?? undefined,
        );
      }
    }

    vi.useRealTimers();
  });

  it("agrees on the far side of the boundary too", () => {
    stubSystemTheme(false);
    vi.setSystemTime(at(9));

    run(themeBootScript(EVENING_DARK));

    expect(document.documentElement.dataset.theme).toBe("light");
    vi.useRealTimers();
  });

  it("publishes the schedule for the toggle and the recompute to read", () => {
    run(themeBootScript(EVENING_DARK));

    expect(readSchedule()).toEqual(EVENING_DARK);
  });

  it("publishes nothing and writes nothing when there is no schedule (R12)", () => {
    window.localStorage.clear();

    run(themeBootScript(null));

    expect(document.documentElement.dataset.themeSchedule).toBeUndefined();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("survives storage throwing, rather than blocking first paint", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage partition blocked");
      });

    expect(() => run(themeBootScript(EVENING_DARK))).not.toThrow();

    getItem.mockRestore();
  });
});

describe("re-evaluating across the switchover (R15)", () => {
  beforeEach(() => {
    clearPendingThemeWrite();
  });

  it("flips the applied appearance when the boundary is crossed", () => {
    stubSystemTheme(false);
    boot(EVENING_DARK, at(18, 55));
    expect(document.documentElement.dataset.theme).toBe("light");

    expect(recomputeTheme({ schedule: EVENING_DARK, now: at(19, 0) })).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("changes nothing for a reader who has stated a preference", () => {
    stubSystemTheme(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    boot(EVENING_DARK, at(18, 55));

    expect(recomputeTheme({ schedule: EVENING_DARK, now: at(19, 0) })).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("performs no write when the resolved value is already applied", () => {
    stubSystemTheme(false);
    boot(EVENING_DARK, at(21));
    const defer = vi.fn((write: () => void) => write());

    expect(recomputeTheme({ schedule: EVENING_DARK, now: at(22), defer })).toBe(
      false,
    );
    expect(defer).not.toHaveBeenCalled();
  });

  it("resolves against the new wall-clock reading after an hour's shift (DST)", () => {
    stubSystemTheme(false);
    boot(EVENING_DARK, at(18, 30));

    // An armed timer would still be counting down 30 minutes of elapsed time.
    recomputeTheme({ schedule: EVENING_DARK, now: at(19, 30) });

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("re-resolves when the reported local time moves backwards too", () => {
    stubSystemTheme(false);
    boot(EVENING_DARK, at(21));
    expect(document.documentElement.dataset.theme).toBe("dark");

    // The reader flew west; their clock now reads mid-afternoon.
    recomputeTheme({ schedule: EVENING_DARK, now: at(15) });

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("defers the write while a transition is in flight, and applies once", async () => {
    stubSystemTheme(false);
    boot(EVENING_DARK, at(18, 55));

    let release: (() => void) | null = null;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    const defer = (write: () => void) => {
      void inFlight.then(write);
    };
    const applied: Array<string | undefined> = [];

    // The boundary is noticed twice inside the same transition.
    recomputeTheme({ schedule: EVENING_DARK, now: at(19, 0), defer });
    recomputeTheme({ schedule: EVENING_DARK, now: at(19, 1), defer });

    expect(document.documentElement.dataset.theme).toBe("light");

    release!();
    // Drained rather than counted synchronously — a synchronous assertion here
    // is green by construction whether or not the deferral works.
    await inFlight;
    await Promise.resolve();
    await Promise.resolve();
    applied.push(document.documentElement.dataset.theme);

    expect(applied).toEqual(["dark"]);
  });

  it("still lands the latest value when two boundaries queue behind one wait", async () => {
    stubSystemTheme(false);
    boot(EVENING_DARK, at(18, 55));

    const writes: Array<() => void> = [];
    const defer = (write: () => void) => writes.push(write);

    recomputeTheme({ schedule: EVENING_DARK, now: at(19, 0), defer });
    // Reader states a preference for light while the write is still waiting.
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    recomputeTheme({ schedule: EVENING_DARK, now: at(19, 1), defer });

    for (const write of writes) write();

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("removes the attribute when a schedule is cleared mid-session (R12)", () => {
    stubSystemTheme(true);
    boot(EVENING_DARK, at(9));
    expect(document.documentElement.dataset.theme).toBe("light");

    recomputeTheme({ schedule: null, now: at(9) });

    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe("the address bar follows the resolved appearance (R17, AE9)", () => {
  function chrome(): HTMLMetaElement | null {
    return document.getElementById("xen-theme-color") as HTMLMetaElement | null;
  }

  it("is written by the apply step, so every caller drives it", () => {
    stubSystemTheme(true);

    applyTheme("light");

    expect(chrome()?.getAttribute("content")).toBe(THEME_COLORS.light);
    expect(chrome()?.getAttribute("name")).toBe("theme-color");
  });

  it("follows a scheduled appearance, not only a toggle", () => {
    stubSystemTheme(true);

    // The path AE9's manual checks cannot reach: no press, no stored choice.
    applyTheme(resolveThemeAttribute(EVENING_LIGHT, at(21)));

    expect(chrome()?.getAttribute("content")).toBe(THEME_COLORS.light);
  });

  it("follows the switchover recompute too", () => {
    stubSystemTheme(false);
    boot(EVENING_DARK, at(18, 55));
    expect(chrome()?.getAttribute("content")).toBe(THEME_COLORS.light);

    recomputeTheme({ schedule: EVENING_DARK, now: at(19, 0) });

    expect(chrome()?.getAttribute("content")).toBe(THEME_COLORS.dark);
  });

  it("comes first in the head, ahead of the layout's OS-keyed pair", () => {
    stubSystemTheme(true);
    const decoy = document.createElement("meta");
    decoy.name = "theme-color";
    decoy.media = "(prefers-color-scheme: dark)";
    document.head.append(decoy);

    applyTheme("light");

    // The first *matching* one wins, and the decoy matches on a dark machine.
    expect(document.head.firstElementChild).toBe(chrome());

    decoy.remove();
  });

  it("updates in place rather than stacking one element per change", () => {
    stubSystemTheme(false);

    applyTheme("dark");
    applyTheme("light");
    applyTheme("dark");

    expect(document.head.querySelectorAll("#xen-theme-color")).toHaveLength(1);
    expect(chrome()?.getAttribute("content")).toBe(THEME_COLORS.dark);
  });

  it("stands aside for a reader with no preference at all (R12)", () => {
    stubSystemTheme(true);
    applyTheme("dark");
    expect(chrome()).not.toBeNull();

    applyTheme(null);

    expect(chrome()).toBeNull();
  });

  it("is written before first paint by the boot script", () => {
    delete document.documentElement.dataset.theme;
    vi.setSystemTime(at(21));

    new Function(themeBootScript(EVENING_DARK))();

    expect(chrome()?.getAttribute("content")).toBe(THEME_COLORS.dark);
    vi.useRealTimers();
  });
});
