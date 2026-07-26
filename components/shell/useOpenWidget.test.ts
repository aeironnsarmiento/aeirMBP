import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { assembleRegistry } from "@/lib/registry/assemble";
import type { WidgetManifest } from "@/lib/registry/types";
import { useOpenWidget } from "./useOpenWidget";

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

function press(key: string, target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
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
