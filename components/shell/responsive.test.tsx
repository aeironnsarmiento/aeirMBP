import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { auditBlurLayers } from "@/components/glass/blurBudget";
import { GlassModal } from "@/components/glass/GlassModal";
import { BLUR_DEPTH_CEILING, GlassSurface } from "@/components/glass/GlassSurface";
import { assembleRegistry } from "@/lib/registry/assemble";
import type { WidgetManifest } from "@/lib/registry/types";
import { DEFAULT_SITE_SETTINGS } from "@/lib/site/schema";
import { SiteProvider } from "./SiteContext";
import { Sidebar } from "./Sidebar";
import { WidgetGrid } from "./WidgetGrid";
import shellStyles from "./shell.module.css";
import modalStyles from "@/components/glass/GlassModal.module.css";

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
    expanded: () => null,
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
        isOwner: false,
      }}
    >
      {children}
    </SiteProvider>
  );
}

describe("blur budget (R6)", () => {
  it("keeps the dashboard within the ceiling", () => {
    const { container } = render(
      withSite(<WidgetGrid registry={REGISTRY} onOpen={() => {}} />),
    );

    const audit = auditBlurLayers(container);

    expect(audit.withinBudget).toBe(true);
    expect(audit.violations).toEqual([]);
    // Three cards blur; the surface nested inside each does not.
    expect(audit.blurred).toBe(3);
    expect(audit.suppressed).toBe(3);
    expect(audit.maxDepth).toBeGreaterThan(BLUR_DEPTH_CEILING);
  });

  it("keeps an expanded widget within the ceiling", () => {
    render(
      <GlassModal open onClose={() => {}} title="Music">
        <GlassSurface tone="well">stat</GlassSurface>
        <GlassSurface tone="well">
          <GlassSurface tone="well">deeply nested</GlassSurface>
        </GlassSurface>
      </GlassModal>,
    );

    const audit = auditBlurLayers(document.body);

    expect(audit.withinBudget).toBe(true);
    // Only the modal panel blurs — everything inside it leans on tint.
    expect(audit.blurred).toBe(1);
  });

  it("does not stack a second full-viewport blur behind the modal panel", () => {
    render(
      <GlassModal open onClose={() => {}} title="Music">
        body
      </GlassModal>,
    );

    const scrim = document.querySelector(`.${modalStyles.scrim}`);
    expect(scrim).not.toBeNull();
    expect(scrim).not.toHaveAttribute("data-blur", "on");
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

describe("reflow below the desktop breakpoint (R7)", () => {
  it("declares a single-column grid and a horizontal nav bar under 900px", () => {
    // jsdom does not evaluate media queries, so the rules themselves are the
    // assertion: the stylesheet must carry a max-width:899px block that
    // collapses the grid and turns the sidebar into a nav bar.
    const css = shellStyles as unknown as Record<string, string>;

    expect(css.shell).toBeTruthy();
    expect(css.sidebar).toBeTruthy();
    expect(css.grid).toBeTruthy();
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
    render(withSite(<WidgetGrid registry={REGISTRY} onOpen={() => {}} />));

    expect(screen.getByLabelText("Open Music")).toHaveAttribute(
      "data-span",
      "two",
    );
    expect(screen.getByLabelText("Open About")).toHaveAttribute(
      "data-span",
      "one",
    );
  });

  it("presents the expanded widget through the sheet-capable panel", () => {
    render(
      <GlassModal open onClose={() => {}} title="Music">
        body
      </GlassModal>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain(modalStyles.panel);
  });
});

describe("the shell survives expansion (R1)", () => {
  it("does not unmount the dashboard when a widget expands", () => {
    const { rerender } = render(
      withSite(<WidgetGrid registry={REGISTRY} onOpen={() => {}} />),
    );
    const cardBefore = screen.getByLabelText("Open About");

    rerender(
      withSite(
        <>
          <WidgetGrid registry={REGISTRY} onOpen={() => {}} />
          <GlassModal open onClose={() => {}} title="About">
            body
          </GlassModal>
        </>,
      ),
    );

    expect(screen.getByLabelText("Open About")).toBe(cardBefore);
  });
});
