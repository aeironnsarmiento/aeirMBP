import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleRegistry } from "@/lib/registry/assemble";
import type { WidgetManifest } from "@/lib/registry/types";
import { clearPendingTransitions, useOpenWidget } from "./useOpenWidget";

const NoopView = () => null;

function manifest(overrides: Partial<WidgetManifest> = {}): WidgetManifest {
  return {
    id: "about",
    title: "About",
    hotkey: "a",
    order: 1,
    icon: NoopView,
    compact: NoopView,
    expanded: NoopView,
    ...overrides,
  };
}

const REGISTRY = assembleRegistry([
  manifest({ id: "about", hotkey: "a", order: 1, openByDefault: true }),
  manifest({
    id: "music",
    hotkey: "m",
    order: 2,
    subViews: [
      { id: "recent", label: "Recently played" },
      { id: "artists", label: "Top artists" },
    ],
  }),
  manifest({ id: "projects", hotkey: "p", order: 3 }),
]);

function press(
  key: string,
  target: EventTarget = window,
  init: KeyboardEventInit = {},
) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

/** Stubs the API and returns the spy, so a test can count transitions. */
function stubViewTransition() {
  clearPendingTransitions();
  const startViewTransition = vi.fn((callback: () => void) => {
    callback();
    return { finished: Promise.resolve() };
  });
  Object.assign(document, { startViewTransition });
  return startViewTransition;
}

function restoreViewTransition() {
  Reflect.deleteProperty(document, "startViewTransition");
  clearPendingTransitions();
}

describe("initial state (R4)", () => {
  it("opens the widget marked openByDefault", () => {
    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    expect(result.current.state.widgetId).toBe("about");
  });

  it("returns to the default view when the store is remounted (AE7)", () => {
    const first = renderHook(() => useOpenWidget(REGISTRY));

    act(() => first.result.current.open("music", { subView: "artists" }));
    expect(first.result.current.state).toMatchObject({
      widgetId: "music",
      subView: "artists",
    });

    // A refresh is a fresh mount. Nothing carries over — that is the accepted
    // behaviour, not a defect.
    first.unmount();
    const second = renderHook(() => useOpenWidget(REGISTRY));

    expect(second.result.current.state).toEqual({
      widgetId: "about",
      subView: null,
      params: {},
    });
  });

  it("opens a widget on its first declared sub-view", () => {
    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    act(() => result.current.open("music"));

    expect(result.current.state.subView).toBe("recent");
  });
});

describe("hotkeys (R2)", () => {
  it("opens the matching widget", () => {
    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    press("p");

    expect(result.current.state.widgetId).toBe("projects");
  });

  it("switches widgets rather than stacking modals", () => {
    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    press("m");
    press("p");

    expect(result.current.state.widgetId).toBe("projects");
    expect(result.current.state.subView).toBeNull();
  });

  it("discards the previous widget's sub-view and params when switching", () => {
    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    act(() => result.current.open("music", { subView: "artists" }));
    act(() => result.current.setParam("range", "month"));
    press("p");

    expect(result.current.state).toEqual({
      widgetId: "projects",
      subView: null,
      params: {},
    });
  });

  it("does nothing for an unregistered key", () => {
    const { result } = renderHook(() => useOpenWidget(REGISTRY));
    act(() => result.current.close());

    press("z");
    press("7");

    expect(result.current.state.widgetId).toBeNull();
  });

  it("ignores a key pressed with a modifier, so browser shortcuts still work", () => {
    const { result } = renderHook(() => useOpenWidget(REGISTRY));
    act(() => result.current.close());

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "p", metaKey: true, bubbles: true }),
      );
    });

    expect(result.current.state.widgetId).toBeNull();
  });

  it("ignores keys typed into a field", () => {
    const { result } = renderHook(() => useOpenWidget(REGISTRY));
    act(() => result.current.close());

    const input = document.createElement("input");
    document.body.append(input);
    press("m", input);
    input.remove();

    expect(result.current.state.widgetId).toBeNull();
  });

  it("ignores an unknown widget id", () => {
    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    act(() => result.current.open("nonexistent"));

    expect(result.current.state.widgetId).toBe("about");
  });
});

describe("held keys and no-op opens", () => {
  // Cleanup belongs here rather than at the end of each test: a failing
  // assertion throws first, and a trailing restore would leave the stub on
  // `document` for every test after it.
  afterEach(restoreViewTransition);

  /*
   * The OS fires one keydown, then repeats at roughly 30 a second until
   * release. Every repeat used to reach `open`, and each one queued a full
   * transition behind the last, so a two-second hold left the shell animating
   * for half a minute.
   */
  const HELD = 20;

  /*
   * Transitions queue, so everything after the first is deferred to a
   * microtask. Counting synchronously reports one call while twenty are still
   * chained behind it — a green test over exactly the backlog being fixed.
   */
  async function drainQueue() {
    await act(async () => {
      for (let i = 0; i < HELD + 5; i += 1) await Promise.resolve();
    });
  }

  it("plays one expansion for a held hotkey, not one per repeat", async () => {
    const startViewTransition = stubViewTransition();
    const { result } = renderHook(() => useOpenWidget(REGISTRY));
    startViewTransition.mockClear();

    press("m");
    for (let i = 0; i < HELD; i += 1) press("m", window, { repeat: true });
    await drainQueue();

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(result.current.state.widgetId).toBe("music");
  });

  it("starts nothing when the held key names the widget already showing", () => {
    const startViewTransition = stubViewTransition();
    // About is `openByDefault`, so this is the case a reader hits by resting a
    // finger on the key of the widget they are already looking at.
    const { result } = renderHook(() => useOpenWidget(REGISTRY));
    startViewTransition.mockClear();

    press("a");
    for (let i = 0; i < HELD; i += 1) press("a", window, { repeat: true });

    expect(startViewTransition).toHaveBeenCalledTimes(0);
    expect(result.current.state.widgetId).toBe("about");
  });

  it("does not re-open the widget that is already expanded", () => {
    const startViewTransition = stubViewTransition();
    const { result } = renderHook(() => useOpenWidget(REGISTRY));
    startViewTransition.mockClear();

    act(() => result.current.open("about"));

    expect(startViewTransition).toHaveBeenCalledTimes(0);
  });

  it("still applies a sub-view change to the widget already expanded", async () => {
    const startViewTransition = stubViewTransition();
    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    act(() => result.current.open("music"));
    await drainQueue();
    startViewTransition.mockClear();

    // Same widget, different view — a real state change, so it is not a no-op
    // and intra-widget navigation must keep working.
    act(() => result.current.open("music", { subView: "artists" }));
    await drainQueue();

    expect(result.current.state.subView).toBe("artists");
    expect(startViewTransition).toHaveBeenCalledTimes(1);
  });

  it("still applies params to the widget already expanded", () => {
    const startViewTransition = stubViewTransition();
    const { result } = renderHook(() => useOpenWidget(REGISTRY));
    startViewTransition.mockClear();

    act(() => result.current.open("about", { params: { range: "year" } }));

    expect(result.current.state.params).toEqual({ range: "year" });
    expect(startViewTransition).toHaveBeenCalledTimes(1);
  });

  it("closes once for a held escape", async () => {
    const startViewTransition = stubViewTransition();
    const { result } = renderHook(() => useOpenWidget(REGISTRY));
    startViewTransition.mockClear();

    press("Escape");
    for (let i = 0; i < HELD; i += 1) press("Escape", window, { repeat: true });
    await drainQueue();

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(result.current.state.widgetId).toBeNull();
  });
});

describe("closing (R3)", () => {
  it("returns to the dashboard on esc", () => {
    const { result } = renderHook(() => useOpenWidget(REGISTRY));
    press("m");

    press("Escape");

    expect(result.current.state).toEqual({
      widgetId: null,
      subView: null,
      params: {},
    });
  });

  it("does nothing on esc when the dashboard is already showing", () => {
    const { result } = renderHook(() => useOpenWidget(REGISTRY));
    act(() => result.current.close());
    const before = result.current.state;

    press("Escape");

    expect(result.current.state).toBe(before);
  });

  it("closes through the explicit control", () => {
    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    act(() => result.current.close());

    expect(result.current.state.widgetId).toBeNull();
  });
});

describe("one store value (R13)", () => {
  it("holds the widget, its sub-view and its params in a single object", () => {
    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    act(() => result.current.open("music"));
    act(() => result.current.setSubView("artists"));
    act(() => result.current.setParam("range", "month"));

    expect(result.current.state).toEqual({
      widgetId: "music",
      subView: "artists",
      params: { range: "month" },
    });
  });

  it("keeps existing params when one is changed", () => {
    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    act(() => result.current.open("music"));
    act(() => result.current.setParam("range", "month"));
    act(() => result.current.setParam("edit", "1"));

    expect(result.current.state.params).toEqual({ range: "month", edit: "1" });
  });

  it("accepts params at open time, so one widget can open another into a view", () => {
    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    act(() => result.current.open("about", { params: { edit: "1" } }));

    expect(result.current.state).toEqual({
      widgetId: "about",
      subView: null,
      params: { edit: "1" },
    });
  });
});

describe("motion (R5, R9)", () => {
  it("commits the state change when the platform has no view transition", () => {
    // jsdom implements none, so this is the path the suite runs by default —
    // and the one most likely to regress silently.
    expect(
      (document as Document & { startViewTransition?: unknown })
        .startViewTransition,
    ).toBeUndefined();

    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    act(() => result.current.open("music"));
    expect(result.current.state.widgetId).toBe("music");

    act(() => result.current.close());
    expect(result.current.state.widgetId).toBeNull();
  });

  it("routes the change through a view transition when one exists", () => {
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    vi.stubGlobal("document", Object.assign(document, { startViewTransition }));

    const { result } = renderHook(() => useOpenWidget(REGISTRY));
    startViewTransition.mockClear();

    act(() => result.current.open("music"));

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(result.current.state.widgetId).toBe("music");

    Reflect.deleteProperty(document, "startViewTransition");
    vi.unstubAllGlobals();
  });

  it("queues a second transition instead of aborting the first (R14)", async () => {
    clearPendingTransitions();

    let settle: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      settle = resolve;
    });
    let started = 0;
    const startViewTransition = vi.fn((callback: () => void) => {
      started += 1;
      callback();
      return { finished: started === 1 ? first : Promise.resolve() };
    });
    Object.assign(document, { startViewTransition });

    const { result } = renderHook(() => useOpenWidget(REGISTRY));
    startViewTransition.mockClear();
    started = 0;

    act(() => result.current.open("music"));
    expect(startViewTransition).toHaveBeenCalledTimes(1);

    // Arrives while the first is still running. Starting it now would abort
    // the first and leave it frozen part-faded.
    act(() => result.current.open("projects"));
    expect(startViewTransition).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle?.();
      await first;
    });

    expect(startViewTransition).toHaveBeenCalledTimes(2);
    expect(result.current.state.widgetId).toBe("projects");

    Reflect.deleteProperty(document, "startViewTransition");
    clearPendingTransitions();
  });

  it("releases the queue so a later transition is not deferred", async () => {
    clearPendingTransitions();
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    Object.assign(document, { startViewTransition });

    const { result } = renderHook(() => useOpenWidget(REGISTRY));
    startViewTransition.mockClear();

    await act(async () => {
      result.current.open("music");
      await Promise.resolve();
    });

    // The queue has drained, so this one runs synchronously again rather than
    // paying a microtask for a transition that is long finished.
    act(() => result.current.open("projects"));
    expect(startViewTransition).toHaveBeenCalledTimes(2);
    expect(result.current.state.widgetId).toBe("projects");

    Reflect.deleteProperty(document, "startViewTransition");
    clearPendingTransitions();
  });

  it("handles a skipped transition instead of leaving a rejection loose (R14)", async () => {
    clearPendingTransitions();

    // What a hidden document produces: the transition is skipped outright and
    // both promises reject. Unhandled, this was a console error on every
    // expansion of a backgrounded tab.
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return {
        ready: Promise.reject(new Error("Transition was aborted")),
        finished: Promise.reject(new Error("Transition was aborted")),
      };
    });
    Object.assign(document, { startViewTransition });

    const unhandled: unknown[] = [];
    const onUnhandled = (event: PromiseRejectionEvent) => {
      unhandled.push(event.reason);
    };
    window.addEventListener("unhandledrejection", onUnhandled);

    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    await act(async () => {
      result.current.open("music");
      await Promise.resolve();
    });

    // The skip costs the animation and nothing else.
    expect(result.current.state.widgetId).toBe("music");
    expect(unhandled).toEqual([]);

    // And the queue released, so the next expansion is not stuck behind it.
    act(() => result.current.open("projects"));
    expect(result.current.state.widgetId).toBe("projects");

    window.removeEventListener("unhandledrejection", onUnhandled);
    Reflect.deleteProperty(document, "startViewTransition");
    clearPendingTransitions();
  });

  it("still lands in the requested state when the transition throws", () => {
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      throw new Error("transition skipped");
    });
    Object.assign(document, { startViewTransition });

    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    expect(() => act(() => result.current.open("projects"))).toThrow();
    expect(result.current.state.widgetId).toBe("projects");

    Reflect.deleteProperty(document, "startViewTransition");
  });

  it("settles on the last widget when two are opened in succession", () => {
    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    act(() => {
      result.current.open("music");
      result.current.open("projects");
    });

    expect(result.current.state.widgetId).toBe("projects");
  });
});

describe("swap pairing (R5)", () => {
  // The stationary-pair rule in globals.css keys off `data-vt-swap`; these
  // tests pin the flag's lifetime, since jsdom cannot see what it renames.

  function stubTransition() {
    let settle: (() => void) | undefined;
    const finished = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const seen: boolean[] = [];
    const startViewTransition = vi.fn((callback: () => void) => {
      seen.push(document.documentElement.hasAttribute("data-vt-swap"));
      callback();
      return { finished };
    });
    Object.assign(document, { startViewTransition });
    return { seen, settle: () => settle?.(), finished };
  }

  function teardown() {
    Reflect.deleteProperty(document, "startViewTransition");
    document.documentElement.removeAttribute("data-vt-swap");
    clearPendingTransitions();
  }

  it("marks the root for the length of an expanded-to-expanded switch", async () => {
    clearPendingTransitions();
    const { seen, settle, finished } = stubTransition();
    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    // `about` is open by default, so this is a swap.
    act(() => result.current.open("music"));

    expect(seen).toEqual([true]);
    expect(document.documentElement.hasAttribute("data-vt-swap")).toBe(true);

    await act(async () => {
      settle();
      await finished;
    });
    expect(document.documentElement.hasAttribute("data-vt-swap")).toBe(false);

    teardown();
  });

  it("does not mark an expansion from the dashboard", async () => {
    clearPendingTransitions();
    const seen: boolean[] = [];
    const startViewTransition = vi.fn((callback: () => void) => {
      seen.push(document.documentElement.hasAttribute("data-vt-swap"));
      callback();
      return { finished: Promise.resolve() };
    });
    Object.assign(document, { startViewTransition });
    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    // Each transition settles before the next starts, so neither queues.
    await act(async () => {
      result.current.close();
      await Promise.resolve();
    });
    await act(async () => {
      result.current.open("music");
      await Promise.resolve();
    });

    // close() then open(): both morphs, neither capture saw the flag.
    expect(seen).toEqual([false, false]);
    expect(result.current.state.widgetId).toBe("music");
    expect(document.documentElement.hasAttribute("data-vt-swap")).toBe(false);

    teardown();
  });

  it("starts no transition at all when re-opening the expanded widget", () => {
    clearPendingTransitions();
    const { seen } = stubTransition();
    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    act(() => result.current.open("about"));

    // This used to run one unmarked morph, which was correct about the pairing
    // and wrong about the motion: nothing moves, so there is nothing to
    // animate. An empty list is the stronger guarantee — it cannot be marked
    // as a swap because it never starts.
    expect(seen).toEqual([]);

    teardown();
  });

  it("clears the flag when the transition is skipped", async () => {
    clearPendingTransitions();
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return {
        ready: Promise.reject(new Error("Transition was aborted")),
        finished: Promise.reject(new Error("Transition was aborted")),
      };
    });
    Object.assign(document, { startViewTransition });

    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    await act(async () => {
      result.current.open("music");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.documentElement.hasAttribute("data-vt-swap")).toBe(false);

    teardown();
  });

  it("clears the flag when starting the transition throws", () => {
    clearPendingTransitions();
    const startViewTransition = vi.fn(() => {
      throw new Error("transition skipped");
    });
    Object.assign(document, { startViewTransition });

    const { result } = renderHook(() => useOpenWidget(REGISTRY));

    expect(() => act(() => result.current.open("music"))).toThrow();
    expect(document.documentElement.hasAttribute("data-vt-swap")).toBe(false);

    teardown();
  });
});
