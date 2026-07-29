import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPendingThemeWrite } from "@/components/glass/useTheme";
import { SiteProvider } from "./SiteContext";
import { clearPendingTransitions } from "./useOpenWidget";
import { siteFixture } from "./testSite";
import { TopBar } from "./TopBar";

// The deletion is what needs guarding, not the badge — nothing else in the
// suite renders this component (R1).

function withSite(isOwner: boolean) {
  return (
    <SiteProvider value={siteFixture({ isOwner })}>
      <TopBar nowPlaying={null} />
    </SiteProvider>
  );
}

describe("a visitor's top bar (R1)", () => {
  it("renders no sign-in affordance under any name, role or label", () => {
    render(withSite(false));

    expect(screen.queryByLabelText(/sign in/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/sign in/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
  });

  it("offers no field that could take a secret", () => {
    const { container } = render(withSite(false));

    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(screen.queryByLabelText(/owner secret/i)).not.toBeInTheDocument();
  });

  it("keeps the clock and the theme toggle — the deletion is scoped", () => {
    const { container } = render(withSite(false));

    expect(container.querySelector(`[class*="clock"]`)).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /theme|light|dark/i }),
    ).toBeInTheDocument();
  });
});

describe("a signed-in owner's top bar (R5)", () => {
  it("still renders the badge", () => {
    render(withSite(true));

    expect(screen.getByText("Signed in as owner")).toBeInTheDocument();
  });

  it("renders the badge for nobody else", () => {
    render(withSite(false));

    expect(screen.queryByText("Signed in as owner")).not.toBeInTheDocument();
  });
});

describe("the switchover rides the clock's interval (R15)", () => {
  beforeEach(() => {
    clearPendingThemeWrite();
    clearPendingTransitions();
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.dataset.themeSchedule = "19:00|dark";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete document.documentElement.dataset.themeSchedule;
    delete document.documentElement.dataset.theme;
  });

  it("picks up a boundary crossed in an open tab, without a reload", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 18, 59, 50));

    render(withSite(false));
    expect(document.documentElement.dataset.theme).toBe("light");

    // One tick of the interval the clock already runs.
    vi.setSystemTime(new Date(2026, 6, 28, 19, 0, 5));
    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("leaves a reader who has stated a preference alone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 18, 59, 50));
    window.localStorage.setItem("xen-theme", "light");

    render(withSite(false));

    vi.setSystemTime(new Date(2026, 6, 28, 19, 0, 5));
    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
