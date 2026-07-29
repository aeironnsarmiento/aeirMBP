import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPendingThemeWrite } from "@/components/glass/useTheme";
import { SiteProvider } from "@/components/shell/SiteContext";
import { siteFixture, backgroundsFixture } from "@/components/shell/testSite";
import { clearPendingTransitions } from "@/components/shell/useOpenWidget";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site/schema";
import { SettingsExpanded } from "./expanded";

// The single-patch commitment lives in the panel's wiring, not the settings
// layer — a server-side test cannot see how many requests it made (R8, R9, R16).

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

type Sent = { url: string; method: string; body: unknown };
let sent: Sent[];

function stubFetch(overrides: Record<string, () => Response> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      sent.push({
        url,
        method,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      });

      const key = `${method} ${url.split("?")[0]}`;
      if (overrides[key]) return overrides[key]();

      // Polled on mount; a shapeless answer crashes the render.
      if (key === "GET /api/settings") {
        return Response.json({ settings: DEFAULT_SITE_SETTINGS, backfill: null });
      }
      if (key === "GET /api/music/enrich") {
        return Response.json({ tracks: 0, artists: 0 });
      }
      return Response.json({});
    }),
  );
}

function panel(overrides: Partial<SiteSettings> = {}, urls = {}) {
  const settings = { ...DEFAULT_SITE_SETTINGS, ...overrides };
  return (
    <SiteProvider
      value={siteFixture({
        settings,
        backgrounds: backgroundsFixture(settings, urls),
        isOwner: true,
      })}
    >
      <SettingsExpanded
        params={{}}
        setParam={vi.fn()}
        openWidget={vi.fn()}
        subView={null}
        setSubView={vi.fn()}
      />
    </SiteProvider>
  );
}

const PAIR = { backgroundLightId: "frost", backgroundDarkId: "orchid" };

/** The panel's writes, ignoring the status polls it fires on mount. */
function patches() {
  return sent.filter(
    (request) => request.method === "POST" && request.url.endsWith("/api/settings"),
  );
}

beforeEach(() => {
  sent = [];
  clearPendingThemeWrite();
  clearPendingTransitions();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeSchedule;
  window.localStorage.clear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

describe("assigning a pair (R8)", () => {
  it("posts exactly one patch carrying both members", async () => {
    render(panel());

    await userEvent.click(
      screen.getByRole("button", { name: /split into a light and dark pair/i }),
    );

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({
      backgroundLightId: expect.any(String),
      backgroundDarkId: expect.any(String),
    });
  });

  it("seeds the light slot from a light-mood preset", async () => {
    render(panel({ backgroundId: "orchid" }));

    await userEvent.click(
      screen.getByRole("button", { name: /split into a light and dark pair/i }),
    );

    await waitFor(() => expect(patches()).toHaveLength(1));
    const body = patches()[0].body as Record<string, string>;
    expect(body.backgroundLightId).toBe("frost");
    expect(body.backgroundDarkId).toBe("orchid");
  });

  it("offers a swatch grid per appearance once paired", () => {
    render(panel(PAIR));

    expect(screen.getByText("Light appearance")).toBeInTheDocument();
    expect(screen.getByText("Dark appearance")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /use the dune background for light/i }),
    ).toBeInTheDocument();
  });

  it("patches one slot when one swatch is pressed", async () => {
    render(panel(PAIR));

    await userEvent.click(
      screen.getByRole("button", { name: /use the dune background for dark/i }),
    );

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({ backgroundDarkId: "dune" });
  });

  it("clears both slots when the pair is turned back off", async () => {
    render(panel(PAIR));

    await userEvent.click(
      screen.getByRole("button", { name: /use one background for both/i }),
    );

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({
      backgroundLightId: null,
      backgroundDarkId: null,
    });
  });

  it("names the slot when uploading into one", async () => {
    render(panel(PAIR));

    await userEvent.click(
      screen.getByRole("button", { name: /upload a dark image/i }),
    );

    // The hidden input is what the button clicks; assert it exists and is
    // labelled for the slot, since jsdom cannot complete a file pick.
    expect(
      screen.getByLabelText(/upload a dark background/i),
    ).toBeInTheDocument();
  });

  it("surfaces a validation rejection rather than reporting a save", async () => {
    stubFetch({
      "POST /api/settings": () =>
        Response.json(
          {
            error: "A background pair must be two still images.",
            field: "backgroundDarkId",
          },
          { status: 422 },
        ),
    });
    render(panel(PAIR));

    await userEvent.click(
      screen.getByRole("button", { name: /use the dune background for dark/i }),
    );

    expect(
      await screen.findByText(/two still images/i),
    ).toBeInTheDocument();
  });

  it("clears one slot through the endpoint that reference-counts the bytes", async () => {
    render(panel(PAIR));

    await userEvent.click(
      screen.getByRole("button", { name: /clear the light background/i }),
    );

    await waitFor(() =>
      expect(
        sent.some(
          (request) =>
            request.method === "DELETE" &&
            request.url === "/api/settings/upload?slot=light",
        ),
      ).toBe(true),
    );
  });
});

describe("the switchover control (R9)", () => {
  it("posts a well-formed time", async () => {
    render(panel());

    const input = screen.getByLabelText("Switchover time");
    await userEvent.type(input, "19:00");

    await waitFor(() => expect(patches().length).toBeGreaterThan(0));
    expect(patches().at(-1)!.body).toEqual({ themeSwitchoverAt: "19:00" });
  });

  it("clears the schedule rather than posting an empty string", async () => {
    render(panel({ themeSwitchoverAt: "19:00" }));

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({ themeSwitchoverAt: null });
  });

  it("posts the target appearance on its own", async () => {
    render(panel({ themeSwitchoverAt: "19:00" }));

    await userEvent.selectOptions(
      screen.getByLabelText("Appearance after the switchover"),
      "light",
    );

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({ themeSwitchoverTo: "light" });
  });

  it("shows a value changed elsewhere rather than a mount-time copy", () => {
    const { rerender } = render(panel({ themeSwitchoverAt: "19:00" }));
    expect(screen.getByLabelText("Switchover time")).toHaveValue("19:00");

    rerender(panel({ themeSwitchoverAt: "06:30" }));

    expect(screen.getByLabelText("Switchover time")).toHaveValue("06:30");
  });

  it("describes what the schedule will do, in both directions", () => {
    render(panel({ themeSwitchoverAt: "19:00", themeSwitchoverTo: "dark" }));

    expect(screen.getByText(/19:00 until midnight is dark/)).toBeInTheDocument();
    expect(screen.getByText(/rest of the day is light/)).toBeInTheDocument();
  });
});

describe("preview (R16)", () => {
  it("swaps the whole appearance and posts nothing", async () => {
    document.documentElement.dataset.theme = "light";
    render(panel(PAIR));

    await userEvent.click(
      screen.getByRole("button", { name: /preview the other appearance/i }),
    );

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("dark"),
    );
    expect(patches()).toHaveLength(0);
  });

  it("ends when the panel closes", async () => {
    // A stored choice, so releasing the preview has a real value to land on.
    window.localStorage.setItem("xen-theme", "light");
    document.documentElement.dataset.theme = "light";
    const { unmount } = render(panel(PAIR));

    await userEvent.click(
      screen.getByRole("button", { name: /preview the other appearance/i }),
    );
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("dark"),
    );

    unmount();

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("light"),
    );
  });

  it("ends when the control is pressed again", async () => {
    window.localStorage.setItem("xen-theme", "light");
    document.documentElement.dataset.theme = "light";
    render(panel(PAIR));

    await userEvent.click(
      screen.getByRole("button", { name: /preview the other appearance/i }),
    );
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("dark"),
    );

    await userEvent.click(screen.getByRole("button", { name: /end preview/i }));

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("light"),
    );
  });

  it("holds the schedule, so a boundary crossed mid-preview changes nothing", async () => {
    const { recomputeTheme } = await import("@/components/glass/useTheme");
    document.documentElement.dataset.theme = "light";
    document.documentElement.dataset.themeSchedule = "19:00|dark";
    render(panel(PAIR));

    await userEvent.click(
      screen.getByRole("button", { name: /preview the other appearance/i }),
    );
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("dark"),
    );

    // The switchover fires underneath, resolving light — before 19:00.
    expect(
      recomputeTheme({ now: new Date(2026, 6, 28, 9, 0) }),
    ).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("releasing a preview lands on what readers are getting", () => {
  it("hands an unpinned reader back to their operating system (R12)", async () => {
    // No stored choice, no schedule: the correct state is no attribute at all,
    // not whatever happened to be applied when the preview started.
    document.documentElement.dataset.theme = "light";
    const { unmount } = render(panel(PAIR));

    await userEvent.click(
      screen.getByRole("button", { name: /preview the other appearance/i }),
    );
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("dark"),
    );

    unmount();

    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBeUndefined(),
    );
  });

  it("picks up a boundary that passed while the preview was up", async () => {
    document.documentElement.dataset.theme = "light";
    document.documentElement.dataset.themeSchedule = "00:00|dark";
    const { unmount } = render(panel(PAIR));

    await userEvent.click(
      screen.getByRole("button", { name: /preview the other appearance/i }),
    );
    unmount();

    // The schedule resolves dark all day, which is where the release lands.
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("dark"),
    );
  });
});
