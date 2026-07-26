import { describe, expect, it } from "vitest";
import {
  RegistryError,
  assembleRegistry,
  defaultSubView,
  defaultWidgetId,
  findWidget,
  visibleWidgets,
  widgetForHotkey,
} from "./assemble";
import type { WidgetManifest } from "./types";

const NoopIcon = () => null;
const NoopView = () => null;

function manifest(overrides: Partial<WidgetManifest> = {}): WidgetManifest {
  return {
    id: "about",
    title: "About",
    hotkey: "a",
    order: 1,
    icon: NoopIcon,
    compact: NoopView,
    expanded: NoopView,
    ...overrides,
  };
}

describe("admin gating (R16)", () => {
  const registry = assembleRegistry([
    manifest({ id: "about", hotkey: "a", order: 1 }),
    manifest({ id: "settings", hotkey: "s", order: 9, adminOnly: true }),
  ]);

  it("omits admin-only manifests from an unauthenticated registry entirely (AE2)", () => {
    const visible = visibleWidgets(registry, false);

    expect(visible.map((entry) => entry.id)).toEqual(["about"]);
    expect(findWidget(visible, "settings")).toBeNull();
    expect(widgetForHotkey(visible, "s")).toBeNull();
  });

  it("includes admin-only manifests for the owner", () => {
    const visible = visibleWidgets(registry, true);

    expect(visible.map((entry) => entry.id)).toEqual(["about", "settings"]);
    expect(findWidget(visible, "settings")?.id).toBe("settings");
  });

  it("leaves the source registry untouched when filtering", () => {
    visibleWidgets(registry, false);

    expect(registry.map((entry) => entry.id)).toEqual(["about", "settings"]);
  });
});

describe("assembly-time validation", () => {
  it("rejects two manifests claiming the same hotkey rather than shadowing one", () => {
    expect(() =>
      assembleRegistry([
        manifest({ id: "about", hotkey: "m" }),
        manifest({ id: "music", hotkey: "m", order: 2 }),
      ]),
    ).toThrow(RegistryError);
  });

  it("names both claimants in the hotkey collision message", () => {
    expect(() =>
      assembleRegistry([
        manifest({ id: "about", hotkey: "m" }),
        manifest({ id: "music", hotkey: "m", order: 2 }),
      ]),
    ).toThrow(/about.*music|music.*about/);
  });

  it("rejects a duplicate widget id", () => {
    expect(() =>
      assembleRegistry([
        manifest({ id: "about", hotkey: "a" }),
        manifest({ id: "about", hotkey: "b", order: 2 }),
      ]),
    ).toThrow(RegistryError);
  });

  it("rejects a hotkey that is not a single lowercase letter or digit", () => {
    for (const hotkey of ["", "ab", "A", "Escape", " "]) {
      expect(() => assembleRegistry([manifest({ hotkey })])).toThrow(
        RegistryError,
      );
    }
  });

  it("rejects duplicate sub-view ids within one widget", () => {
    expect(() =>
      assembleRegistry([
        manifest({
          subViews: [
            { id: "recent", label: "Recent" },
            { id: "recent", label: "Recently played" },
          ],
        }),
      ]),
    ).toThrow(RegistryError);
  });

  it("rejects two widgets both marked openByDefault", () => {
    expect(() =>
      assembleRegistry([
        manifest({ id: "about", hotkey: "a", openByDefault: true }),
        manifest({ id: "music", hotkey: "m", order: 2, openByDefault: true }),
      ]),
    ).toThrow(RegistryError);
  });
});

describe("ordering and lookup", () => {
  it("orders by declared position and is stable across calls", () => {
    const input = [
      manifest({ id: "settings", hotkey: "s", order: 9 }),
      manifest({ id: "music", hotkey: "m", order: 2 }),
      manifest({ id: "about", hotkey: "a", order: 1 }),
    ];

    const first = assembleRegistry(input).map((entry) => entry.id);
    const second = assembleRegistry(input).map((entry) => entry.id);

    expect(first).toEqual(["about", "music", "settings"]);
    expect(second).toEqual(first);
  });

  it("breaks an order tie deterministically by id", () => {
    const ids = assembleRegistry([
      manifest({ id: "zeta", hotkey: "z", order: 1 }),
      manifest({ id: "alpha", hotkey: "b", order: 1 }),
    ]).map((entry) => entry.id);

    expect(ids).toEqual(["alpha", "zeta"]);
  });

  it("resolves a hotkey case-insensitively", () => {
    const registry = assembleRegistry([manifest({ id: "music", hotkey: "m" })]);

    expect(widgetForHotkey(registry, "M")?.id).toBe("music");
    expect(widgetForHotkey(registry, "m")?.id).toBe("music");
  });

  it("returns null for an unbound key", () => {
    const registry = assembleRegistry([manifest()]);

    expect(widgetForHotkey(registry, "q")).toBeNull();
  });

  it("reports the widget opened on first load (R4)", () => {
    const registry = assembleRegistry([
      manifest({ id: "music", hotkey: "m", order: 2 }),
      manifest({ id: "about", hotkey: "a", order: 1, openByDefault: true }),
    ]);

    expect(defaultWidgetId(registry)).toBe("about");
    expect(defaultWidgetId(assembleRegistry([manifest()]))).toBeNull();
  });

  it("reports a widget's first sub-view as its default", () => {
    const withSubViews = manifest({
      subViews: [
        { id: "recent", label: "Recently played" },
        { id: "artists", label: "Top artists" },
      ],
    });

    expect(defaultSubView(withSubViews)).toBe("recent");
    expect(defaultSubView(manifest())).toBeNull();
  });
});
