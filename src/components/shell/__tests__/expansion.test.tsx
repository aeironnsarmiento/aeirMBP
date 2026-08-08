import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { assembleRegistry } from "@/lib/registry/assemble";
import type { WidgetManifest } from "@/lib/registry/types";
import { SiteProvider } from "../SiteContext";
import { siteFixture } from "../testSite";
import { WidgetGrid } from "../WidgetGrid/WidgetGrid";
import { closedStore, storeOpenOn } from "../testStore";

const Icon = () => null;

function manifest(overrides: Partial<WidgetManifest> = {}): WidgetManifest {
  return {
    id: "about",
    title: "About",
    hotkey: "a",
    order: 1,
    icon: Icon,
    compact: () => <p>about summary</p>,
    expanded: () => <p>about detail</p>,
    ...overrides,
  };
}

const REGISTRY = assembleRegistry([
  manifest({ id: "about", title: "About", hotkey: "a", order: 1 }),
  manifest({
    id: "music",
    title: "Music",
    hotkey: "m",
    order: 2,
    compact: () => <p>music summary</p>,
    expanded: () => <p>music detail</p>,
    subViews: [
      { id: "recent", label: "Recently played" },
      { id: "artists", label: "Top artists" },
    ],
  }),
  manifest({
    id: "projects",
    title: "Projects",
    hotkey: "p",
    order: 3,
    compact: () => <p>projects summary</p>,
    expanded: () => <p>projects detail</p>,
  }),
]);

function withSite(children: React.ReactNode) {
  return (
    <SiteProvider
      value={siteFixture()}
    >
      {children}
    </SiteProvider>
  );
}

describe("expanding in place (R4)", () => {
  it("renders the open widget's expanded view and keeps its siblings mounted", () => {
    render(withSite(<WidgetGrid registry={REGISTRY} store={storeOpenOn("music")} />));

    expect(screen.getByText("music detail")).toBeInTheDocument();
    expect(screen.queryByText("music summary")).not.toBeInTheDocument();

    // Siblings stay on the page rather than being covered by an overlay.
    expect(screen.getByLabelText("Open About")).toBeInTheDocument();
    expect(screen.getByLabelText("Open Projects")).toBeInTheDocument();
  });

  it("marks exactly one widget expanded and the rest compact", () => {
    render(withSite(<WidgetGrid registry={REGISTRY} store={storeOpenOn("music")} />));

    const expanded = document.querySelectorAll('[data-state="expanded"]');
    const compact = document.querySelectorAll('[data-state="compact"]');

    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toHaveAttribute("data-widget", "music");
    expect(compact).toHaveLength(2);
  });

  it("moves the open widget when a different one is opened", () => {
    const { rerender } = render(
      withSite(<WidgetGrid registry={REGISTRY} store={storeOpenOn("music")} />),
    );
    expect(screen.getByText("music detail")).toBeInTheDocument();

    rerender(
      withSite(<WidgetGrid registry={REGISTRY} store={storeOpenOn("projects")} />),
    );

    expect(screen.queryByText("music detail")).not.toBeInTheDocument();
    expect(screen.getByText("projects detail")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-state="expanded"]')).toHaveLength(1);
  });

  it("opens a widget when its compact card is activated", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    render(
      withSite(<WidgetGrid registry={REGISTRY} store={closedStore({ open })} />),
    );

    await user.click(screen.getByLabelText("Open Music"));

    expect(open).toHaveBeenCalledWith("music");
  });

  it("renders every widget's compact view when nothing is open", () => {
    render(withSite(<WidgetGrid registry={REGISTRY} store={closedStore()} />));

    expect(screen.getByText("about summary")).toBeInTheDocument();
    expect(screen.getByText("music summary")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-state="expanded"]')).toHaveLength(0);
  });
});

describe("dismissal and focus (R7)", () => {
  it("returns focus to the card that was expanded when it collapses", () => {
    const { rerender } = render(
      withSite(<WidgetGrid registry={REGISTRY} store={storeOpenOn("music")} />),
    );

    rerender(withSite(<WidgetGrid registry={REGISTRY} store={closedStore()} />));

    expect(screen.getByLabelText("Open Music")).toHaveFocus();
  });

  it("does not steal focus when nothing was expanded", () => {
    const { rerender } = render(
      withSite(<WidgetGrid registry={REGISTRY} store={closedStore()} />),
    );

    rerender(withSite(<WidgetGrid registry={REGISTRY} store={closedStore()} />));

    expect(document.body).toHaveFocus();
  });

  /*
   * Focus follows the expansion for the same reason it returns on collapse:
   * the reader's attention is on the widget that just became prominent, and
   * assistive technology should land there rather than wherever the pointer
   * happened to leave it.
   *
   * It also settles the stale-focus ring. A card clicked with a pointer keeps
   * focus without drawing a ring, and the browser re-qualifies that focus as
   * keyboard focus the moment any key is pressed — so an unrelated hotkey made
   * a ring appear on a card nobody had navigated to. Moving focus off it means
   * there is nothing stale left to re-qualify.
   */
  it("moves focus into the widget that expands", () => {
    const { rerender } = render(
      withSite(<WidgetGrid registry={REGISTRY} store={closedStore()} />),
    );

    rerender(
      withSite(<WidgetGrid registry={REGISTRY} store={storeOpenOn("music")} />),
    );

    expect(screen.getByRole("region", { name: "Music" })).toHaveFocus();
  });

  it("moves focus with the widget when one expansion replaces another", () => {
    const { rerender } = render(
      withSite(<WidgetGrid registry={REGISTRY} store={storeOpenOn("music")} />),
    );

    rerender(
      withSite(<WidgetGrid registry={REGISTRY} store={storeOpenOn("about")} />),
    );

    expect(screen.getByRole("region", { name: "About" })).toHaveFocus();
  });

  it("does not steal focus for the widget that is already open on first render", () => {
    // A widget is expanded on load, so without this guard every visit would
    // pull focus into it before the reader has done anything.
    render(
      withSite(<WidgetGrid registry={REGISTRY} store={storeOpenOn("music")} />),
    );

    expect(document.body).toHaveFocus();
  });

  it("offers a collapse control that reports the expanded state", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(
      withSite(
        <WidgetGrid registry={REGISTRY} store={storeOpenOn("music", {}, { close })} />,
      ),
    );

    const control = screen.getByLabelText("Collapse Music");
    expect(control).toHaveAttribute("aria-expanded", "true");

    await user.click(control);
    expect(close).toHaveBeenCalled();
  });
});

describe("assistive-technology semantics (R8)", () => {
  it("exposes the expanded widget as a region, never as a dialog", () => {
    render(withSite(<WidgetGrid registry={REGISTRY} store={storeOpenOn("music")} />));

    expect(screen.getByRole("region", { name: "Music" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("leaves sibling cards focusable while a widget is expanded", () => {
    render(withSite(<WidgetGrid registry={REGISTRY} store={storeOpenOn("music")} />));

    for (const label of ["Open About", "Open Projects"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("tabindex", "0");
    }
  });

  it("reports aria-expanded on a compact card", () => {
    render(withSite(<WidgetGrid registry={REGISTRY} store={closedStore()} />));

    expect(screen.getByLabelText("Open Music")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("sub-views (R14 registry discipline)", () => {
  it("renders the open widget's sub-view tabs from its manifest", () => {
    render(withSite(<WidgetGrid registry={REGISTRY} store={storeOpenOn("music")} />));

    const tabs = screen.getByRole("tablist", { name: "Music views" });
    expect(tabs).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Recently played" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Top artists" })).toBeInTheDocument();
  });

  it("marks the active sub-view and switches without collapsing", async () => {
    const user = userEvent.setup();
    const setSubView = vi.fn();
    render(
      withSite(
        <WidgetGrid
          registry={REGISTRY}
          store={storeOpenOn("music", { subView: "recent" }, { setSubView })}
        />,
      ),
    );

    expect(screen.getByRole("tab", { name: "Recently played" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(screen.getByRole("tab", { name: "Top artists" }));

    expect(setSubView).toHaveBeenCalledWith("artists");
    expect(screen.getByText("music detail")).toBeInTheDocument();
  });

  it("renders no tablist for a widget that declares no sub-views", () => {
    render(withSite(<WidgetGrid registry={REGISTRY} store={storeOpenOn("about")} />));

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});

describe("sub-view switcher accessibility (WAI-ARIA tabs)", () => {
  function renderTabs(subView = "recent") {
    return render(
      withSite(
        <WidgetGrid
          registry={REGISTRY}
          store={storeOpenOn("music", { subView })}
        />,
      ),
    );
  }

  it("associates the tabs with the panel they control", () => {
    renderTabs();

    const panel = screen.getByRole("tabpanel");
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveAttribute("aria-controls", panel.id);
    }
  });

  it("labels the panel with whichever tab is selected", () => {
    renderTabs("artists");

    const panel = screen.getByRole("tabpanel");
    const selected = screen.getByRole("tab", { name: "Top artists" });

    expect(panel).toHaveAttribute("aria-labelledby", selected.id);
    expect(selected).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the strip to a single tab stop with a roving tabindex", () => {
    renderTabs("artists");

    expect(screen.getByRole("tab", { name: "Top artists" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("tab", { name: "Recently played" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("leaves the panel reachable so it can be scrolled by keyboard", () => {
    renderTabs();

    expect(screen.getByRole("tabpanel")).toHaveAttribute("tabindex", "0");
  });

  it("moves through the views with the arrow keys", async () => {
    const user = userEvent.setup();
    const setSubView = vi.fn();
    render(
      withSite(
        <WidgetGrid
          registry={REGISTRY}
          store={storeOpenOn("music", { subView: "recent" }, { setSubView })}
        />,
      ),
    );

    screen.getByRole("tab", { name: "Recently played" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(setSubView).toHaveBeenCalledWith("artists");
  });

  it("wraps at both ends rather than dead-ending", async () => {
    const user = userEvent.setup();
    const setSubView = vi.fn();
    render(
      withSite(
        <WidgetGrid
          registry={REGISTRY}
          store={storeOpenOn("music", { subView: "recent" }, { setSubView })}
        />,
      ),
    );

    screen.getByRole("tab", { name: "Recently played" }).focus();
    await user.keyboard("{ArrowLeft}");

    // Backwards from the first view lands on the last one.
    expect(setSubView).toHaveBeenCalledWith("artists");
  });

  it("jumps to the ends with Home and End", async () => {
    const user = userEvent.setup();
    const setSubView = vi.fn();
    render(
      withSite(
        <WidgetGrid
          registry={REGISTRY}
          store={storeOpenOn("music", { subView: "artists" }, { setSubView })}
        />,
      ),
    );

    screen.getByRole("tab", { name: "Top artists" }).focus();
    await user.keyboard("{Home}");
    expect(setSubView).toHaveBeenCalledWith("recent");

    await user.keyboard("{End}");
    expect(setSubView).toHaveBeenCalledWith("artists");
  });

  it("renders no tabpanel for a widget with no sub-views", () => {
    render(withSite(<WidgetGrid registry={REGISTRY} store={storeOpenOn("about")} />));

    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
  });
});
