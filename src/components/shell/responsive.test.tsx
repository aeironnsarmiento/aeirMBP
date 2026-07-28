import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { auditBlurLayers } from "@/components/glass/blurBudget";
import { BLUR_DEPTH_CEILING, GlassSurface } from "@/components/glass/GlassSurface";
import { assembleRegistry } from "@/lib/registry/assemble";
import type { WidgetManifest } from "@/lib/registry/types";
import { DEFAULT_SITE_SETTINGS } from "@/lib/site/schema";
import { SiteProvider } from "./SiteContext";
import { Sidebar } from "./Sidebar";
import { WidgetGrid } from "./WidgetGrid";
import { closedStore, storeOpenOn } from "./testStore";
import shellStyles from "./shell.module.css";

/**
 * Read a sibling source file for the assertions that inspect source text.
 *
 * Resolved against this file rather than the working directory: a
 * cwd-relative path silently breaks the moment the directory moves.
 */
const readSibling = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

const Icon = () => null;

/** A compact view with a nested surface, as a real widget card has. */
const Compact = () => (
  <GlassSurface tone="well" data-testid="nested-in-card">
    inner
  </GlassSurface>
);

function manifest(overrides: Partial<WidgetManifest> = {}): WidgetManifest {
  return {
    id: "about",
    title: "About",
    hotkey: "a",
    order: 1,
    icon: Icon,
    compact: Compact,
    expanded: () => <div>expanded body</div>,
    ...overrides,
  };
}

const REGISTRY = assembleRegistry([
  manifest({ id: "about", title: "About", hotkey: "a", order: 1 }),
  manifest({ id: "music", title: "Music", hotkey: "m", order: 2, span: "two" }),
  manifest({ id: "projects", title: "Projects", hotkey: "p", order: 3 }),
]);

function withSite(children: React.ReactNode) {
  return (
    <SiteProvider
      value={{
        settings: DEFAULT_SITE_SETTINGS,
        avatarUrl: null,
        backgroundUrl: null,
        isOwner: false,
      }}
    >
      {children}
    </SiteProvider>
  );
}

/**
 * Mirrors the nesting in `Shell.tsx`: one frame wrapping the sidebar and the
 * grid. Rendering the real `Shell` here would mount every widget's compact
 * view and its data fetching, so the composition is reproduced instead — the
 * assertions are about the depth mechanism, which is the same either way.
 */
function withFrame(children: React.ReactNode) {
  return withSite(
    <GlassSurface as="div" className={shellStyles.shell}>
      {children}
    </GlassSurface>,
  );
}

describe("blur budget (R1, R2, R3)", () => {
  it("blurs the frame and nothing else on the dashboard", () => {
    const { container } = render(
      withFrame(
        <>
          <Sidebar registry={REGISTRY} openWidgetId={null} onOpen={() => {}} />
          <WidgetGrid registry={REGISTRY} store={closedStore()} />
        </>,
      ),
    );

    const audit = auditBlurLayers(container);

    expect(audit.withinBudget).toBe(true);
    expect(audit.violations).toEqual([]);
    // The frame is the only backdrop filter on the page. The sidebar, the
    // three cards, and the surface nested inside each card all lean on tint.
    expect(audit.blurred).toBe(1);
    expect(audit.suppressed).toBe(7);
    expect(audit.maxDepth).toBeGreaterThan(BLUR_DEPTH_CEILING);
  });

  it("puts the sidebar and every card a level below the frame", () => {
    render(
      withFrame(
        <>
          <Sidebar registry={REGISTRY} openWidgetId={null} onOpen={() => {}} />
          <WidgetGrid registry={REGISTRY} store={closedStore()} />
        </>,
      ),
    );

    // data-blur="off" is what drops the drop shadow as well as the filter, so
    // asserting the attribute is asserting R2 — jsdom resolves no cascade.
    for (const label of ["Open About", "Open Music", "Open Projects"]) {
      const card = screen.getByLabelText(label);
      expect(card).toHaveAttribute("data-blur", "off");
      expect(card).toHaveAttribute("data-glass-depth", "2");
    }

    const sidebar = screen.getByLabelText("Widgets");
    expect(sidebar).toHaveAttribute("data-blur", "off");
    expect(sidebar).toHaveAttribute("data-glass-depth", "2");
  });

  it("still blurs only the frame while a widget is expanded", () => {
    const { container } = render(
      withFrame(
        <WidgetGrid registry={REGISTRY} store={storeOpenOn("music")} />,
      ),
    );

    const audit = auditBlurLayers(container);

    expect(audit.withinBudget).toBe(true);
    expect(audit.blurred).toBe(1);
  });

  it("reports a violation if a surface past the ceiling ever blurs", () => {
    const { container } = render(
      <div>
        <div data-glass-depth="2" data-blur="on" className="glass" />
      </div>,
    );

    const audit = auditBlurLayers(container);

    expect(audit.withinBudget).toBe(false);
    expect(audit.violations).toHaveLength(1);
  });
});

describe("reflow below the desktop breakpoint (R6, R7)", () => {
  it("declares a single-column grid and a horizontal nav bar under 900px", () => {
    const css = shellStyles as unknown as Record<string, string>;

    expect(css.viewport).toBeTruthy();
    expect(css.shell).toBeTruthy();
    expect(css.sidebar).toBeTruthy();
    expect(css.grid).toBeTruthy();
  });

  it("presents an expanded widget as a full-screen sheet below the breakpoint", () => {
    // jsdom evaluates no media queries and resolves no cascade, so the
    // stylesheet source is the only thing that can carry this assertion.
    const source = readSibling("shell.module.css");
    const breakpointBlock = source.slice(source.indexOf("@media (max-width: 899px)"));

    expect(breakpointBlock).toContain('.grid[data-expanded] .card[data-state="expanded"]');
    expect(breakpointBlock).toContain("height: 100%");
    // No compressed sibling column at 375px.
    expect(breakpointBlock).toContain('.grid[data-expanded] .card[data-state="compact"]');
    expect(breakpointBlock).toContain("display: none");
    // The sheet must not cover the chrome — the way back has to stay visible.
    expect(breakpointBlock).not.toContain("position: fixed");
  });

  it("sizes dashboard rows to a card's full content, not its min-content", () => {
    // jsdom performs no layout, so the declaration is the only assertion
    // available. Without it an auto row resolves a card's flex body from its
    // min-content and a busy summary spills over the card below it.
    const source = readSibling("shell.module.css");
    const dashboardRules = source.slice(0, source.indexOf(".grid[data-expanded]"));

    expect(dashboardRules).toContain("grid-auto-rows: max-content");
  });

  it("renders one tree at every width — no component reads the breakpoint", () => {
    const source = readSibling("WidgetGrid.tsx");

    expect(source).not.toContain("matchMedia");
    expect(source).not.toContain("innerWidth");
  });

  it("renders one nav entry per registry widget, with its hotkey", () => {
    render(
      withSite(
        <Sidebar registry={REGISTRY} openWidgetId="about" onOpen={() => {}} />,
      ),
    );

    const nav = screen.getByRole("navigation");
    const entries = within(nav).getAllByRole("button");

    expect(entries).toHaveLength(REGISTRY.length);
    for (const widget of REGISTRY) {
      expect(within(nav).getByText(widget.title)).toBeInTheDocument();
      expect(within(nav).getByText(widget.hotkey)).toBeInTheDocument();
    }
  });

  it("marks the wide card so the grid can drop its span on a narrow viewport", () => {
    render(withSite(<WidgetGrid registry={REGISTRY} store={closedStore()} />));

    expect(screen.getByLabelText("Open Music")).toHaveAttribute(
      "data-span",
      "two",
    );
    expect(screen.getByLabelText("Open About")).toHaveAttribute(
      "data-span",
      "one",
    );
  });
});

describe("the shell survives expansion (R1, R4)", () => {
  it("does not remount a sibling card when a widget expands", () => {
    const { rerender } = render(
      withSite(<WidgetGrid registry={REGISTRY} store={closedStore()} />),
    );
    const cardBefore = screen.getByLabelText("Open About");

    rerender(
      withSite(<WidgetGrid registry={REGISTRY} store={storeOpenOn("music")} />),
    );

    expect(screen.getByLabelText("Open About")).toBe(cardBefore);
  });
});
