import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteProvider } from "@/components/shell/SiteContext";
import { siteFixture } from "@/components/shell/testSite";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site/schema";
import { AboutExpanded } from "./expanded";

// The About editor's propagation path (R18). The write round trip is covered
// by the handler tests; this half — save, refresh, view shows the new values —
// never was, which is how the defect stayed invisible. It did not reproduce in
// a real browser; see docs/about-save-propagation-diagnosis.md.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

let sent: Array<{ url: string; method: string; body: Record<string, unknown> }>;

function stubFetch(respond: () => Response = () => Response.json({})) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
      });
      return respond();
    }),
  );
}

/** Settings come from the server-resolved context, which a refresh replaces. */
function about(overrides: Partial<SiteSettings> = {}, edit = true) {
  const settings = { ...DEFAULT_SITE_SETTINGS, ...overrides };
  return (
    <SiteProvider value={siteFixture({ settings, isOwner: true })}>
      <AboutExpanded
        params={edit ? { edit: "1" } : {}}
        setParam={setParam}
        openWidget={vi.fn()}
        subView={null}
        setSubView={vi.fn()}
      />
    </SiteProvider>
  );
}

const setParam = vi.fn();

beforeEach(() => {
  sent = [];
  refresh.mockClear();
  setParam.mockClear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saving from the editor (R18)", () => {
  it("posts the draft and asks the router for fresh server state", async () => {
    render(about({ name: "Old Name" }));

    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "New Name");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/api/about");
    expect(sent[0].method).toBe("POST");
    expect(sent[0].body.name).toBe("New Name");
  });

  it("shows the new values once fresh server state arrives, with no reload", async () => {
    // The load-bearing one. A refresh that lands but never reaches the view is
    // exactly what the defect looks like from the owner's chair.
    const { rerender } = render(about({ name: "Old Name" }, false));
    expect(screen.getByText("Old Name")).toBeInTheDocument();

    rerender(about({ name: "New Name" }, false));

    expect(screen.getByText("New Name")).toBeInTheDocument();
    expect(screen.queryByText("Old Name")).not.toBeInTheDocument();
  });

  it("leaves edit mode only after the save has succeeded", async () => {
    render(about());

    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(setParam).toHaveBeenCalledWith("edit", "0"));
    expect(refresh).toHaveBeenCalled();
  });

  it("re-seeds the draft from server state when the editor is reopened", async () => {
    // The form seeds its draft once per mount. Closing the editor unmounts it,
    // so a save followed by a reopen must not show the pre-save value.
    const { rerender } = render(about({ name: "Old Name" }, false));

    rerender(about({ name: "New Name" }, true));

    expect(screen.getByLabelText("Name")).toHaveValue("New Name");
  });

  it("stays in edit mode and reports the failure when the save is refused", async () => {
    stubFetch(() =>
      Response.json({ error: "About copy must be text" }, { status: 422 }),
    );
    render(about());

    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/about copy must be text/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(setParam).not.toHaveBeenCalledWith("edit", "0");
  });

  it("reports a bodiless rejection as its status rather than a parse error (U14)", async () => {
    stubFetch(() => new Response(null, { status: 404 }));
    render(about());

    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const message = await screen.findByText(/404/);
    expect(message.textContent).not.toMatch(/JSON|Unexpected|parse/i);
    expect(refresh).not.toHaveBeenCalled();
  });
});
