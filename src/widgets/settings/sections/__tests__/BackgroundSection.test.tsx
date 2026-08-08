import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPendingThemeWrite } from "@/components/glass/useTheme";
import type { ImageCropperProps } from "@/components/media/ImageCropper/ImageCropper";
import { clearPendingTransitions } from "@/components/shell/useOpenWidget";
import { backgroundsFixture } from "@/components/shell/testSite";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site/schema";
import {
  resetSentRequests,
  sentRequests,
  stubSettingsFetch,
} from "../../testFetch";
import {
  BackgroundSection,
  type BackgroundSectionProps,
} from "../BackgroundSection/BackgroundSection";

const transcodeAnimation = vi.hoisted(() =>
  vi.fn<(original: File) => Promise<File>>(),
);

vi.mock("@/widgets/settings/media/transcodeAnimation", () => ({
  transcodeAnimation,
}));

vi.mock("@/components/media/ImageCropper/ImageCropper", () => ({
  ImageCropper: (props: ImageCropperProps) => (
    <div role="region" aria-label={`Crop ${props.label}`}>
      <button
        type="button"
        onClick={() =>
          props.onCommit(
            new File(["cropped"], "background.webp", { type: "image/webp" }),
          )
        }
      >
        Commit background crop
      </button>
      <button type="button" onClick={props.onCancel}>
        Cancel background crop
      </button>
    </div>
  ),
}));

const PAIR = { backgroundLightId: "frost", backgroundDarkId: "orchid" };
const beginActivity = vi.fn();
const reportActivity = vi.fn();
const endActivity = vi.fn();
const selectPendingAsset = vi.fn();
const clearPendingAsset = vi.fn();
const refresh = vi.fn();

function backgroundSection(
  overrides: Partial<SiteSettings> = {},
  urls: Partial<Record<"single" | "light" | "dark", string | null>> = {},
  props: Partial<BackgroundSectionProps> = {},
) {
  const settings = { ...DEFAULT_SITE_SETTINGS, ...overrides };
  return (
    <BackgroundSection
      settings={settings}
      backgrounds={backgroundsFixture(settings, urls)}
      busy={null}
      pendingAsset={null}
      beginActivity={beginActivity}
      reportActivity={reportActivity}
      endActivity={endActivity}
      selectPendingAsset={selectPendingAsset}
      clearPendingAsset={clearPendingAsset}
      refresh={refresh}
      {...props}
    />
  );
}

function patches() {
  return sentRequests.filter(
    ({ method, url }) => method === "POST" && url === "/api/settings",
  );
}

beforeEach(() => {
  resetSentRequests();
  vi.clearAllMocks();
  transcodeAnimation.mockImplementation(async (file) => file);
  clearPendingThemeWrite();
  clearPendingTransitions();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeSchedule;
  window.localStorage.clear();
  stubSettingsFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeSchedule;
});

describe("BackgroundSection", () => {
  it("posts one pair patch and only the selected slot patch", async () => {
    const first = render(backgroundSection({ backgroundId: "orchid" }));

    await userEvent.click(
      screen.getByRole("button", { name: /split into a light and dark pair/i }),
    );
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({
      backgroundLightId: "frost",
      backgroundDarkId: "orchid",
    });

    first.unmount();
    resetSentRequests();
    render(backgroundSection(PAIR));
    await userEvent.click(
      screen.getByRole("button", { name: /use the dune background for dark/i }),
    );
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({ backgroundDarkId: "dune" });
  });

  it("unpairs custom slots light-then-dark and patches after a delete error", async () => {
    stubSettingsFetch({
      "DELETE /api/settings/upload": (request) =>
        request.url.endsWith("slot=light")
          ? Response.json({ error: "Light delete failed." }, { status: 500 })
          : Response.json({}),
    });
    render(
      backgroundSection(PAIR, {
        light: "https://storage.example/light",
        dark: "https://storage.example/dark",
      }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: /use one background for both/i }),
    );

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(
      sentRequests
        .filter(({ method }) => method === "DELETE" || method === "POST")
        .map(({ method, url }) => `${method} ${url}`),
    ).toEqual([
      "DELETE /api/settings/upload?slot=light",
      "DELETE /api/settings/upload?slot=dark",
      "POST /api/settings",
    ]);
    expect(patches()[0].body).toEqual({
      backgroundLightId: null,
      backgroundDarkId: null,
    });
  });

  it("reports animation reduction and completes sign, store, and confirm", async () => {
    const encoded = new File(["tiny"], "background.webm", {
      type: "video/webm",
    });
    transcodeAnimation.mockResolvedValue(encoded);
    stubSettingsFetch({
      "POST /api/settings/upload": () =>
        Response.json({
          signedUrl: "https://storage.example/upload",
          path: "backgrounds/owned.webm",
        }),
      "PUT https://storage.example/upload": () => Response.json({}),
      "PUT /api/settings/upload": () => Response.json({}),
    });
    render(backgroundSection());

    await userEvent.upload(
      screen.getByLabelText("Upload a background"),
      new File(["a much larger animated file"], "background.gif", {
        type: "image/gif",
      }),
    );

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(reportActivity).toHaveBeenCalledWith({
      tone: "ok",
      message: expect.stringMatching(/^Animation re-encoded: .* → .*\.$/),
    });
    expect(reportActivity).toHaveBeenLastCalledWith({
      tone: "ok",
      message: "Background updated for every visitor.",
    });
    expect(
      sentRequests
        .filter(({ url }) =>
          url.includes("/api/settings/upload") ||
          url === "https://storage.example/upload",
        )
        .map(({ method }) => method),
    ).toEqual(["POST", "PUT", "PUT"]);
  });

  it("keeps a paired dark-slot crop attached through sign, store, and confirm", async () => {
    stubSettingsFetch({
      "POST /api/settings/upload": () =>
        Response.json({
          signedUrl: "https://storage.example/dark-upload",
          path: "backgrounds/dark.webp",
        }),
      "PUT https://storage.example/dark-upload": () => Response.json({}),
      "PUT /api/settings/upload": () => Response.json({}),
    });
    const view = render(backgroundSection(PAIR));
    const original = new File(["original"], "dark.png", { type: "image/png" });

    await userEvent.upload(
      screen.getByLabelText("Upload a dark background"),
      original,
    );

    expect(selectPendingAsset).toHaveBeenCalledWith({
      kind: "background",
      file: original,
      appearance: "dark",
    });
    const pendingAsset = selectPendingAsset.mock.calls[0][0];
    view.rerender(backgroundSection(PAIR, {}, { pendingAsset }));

    await userEvent.click(
      screen.getByRole("button", { name: "Commit background crop" }),
    );

    await waitFor(() => expect(endActivity).toHaveBeenCalledOnce());
    expect(beginActivity).toHaveBeenCalledWith("background:dark");
    expect(clearPendingAsset).toHaveBeenCalledOnce();
    const requests = sentRequests.filter(
      ({ url }) =>
        url.includes("/api/settings/upload") ||
        url === "https://storage.example/dark-upload",
    );
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "POST /api/settings/upload?slot=dark",
      "PUT https://storage.example/dark-upload",
      "PUT /api/settings/upload?slot=dark",
    ]);
    const cropped = requests[1].body as File;
    expect(cropped).toEqual(
      expect.objectContaining({ name: "background.webp", type: "image/webp" }),
    );
    expect(requests[0].body).toEqual({
      type: cropped.type,
      size: cropped.size,
    });
    expect(requests[2].body).toEqual({ path: "backgrounds/dark.webp" });
  });

  it.each([
    {
      failure: "sign",
      expectedMethods: ["POST"],
      expectedMessage: "Signing failed.",
    },
    {
      failure: "store",
      expectedMethods: ["POST", "PUT"],
      expectedMessage: "Storage refused the file (HTTP 503).",
    },
    {
      failure: "confirm",
      expectedMethods: ["POST", "PUT", "PUT"],
      expectedMessage: "Confirmation failed.",
    },
  ])("short-circuits after a $failure failure", async ({
    failure,
    expectedMethods,
    expectedMessage,
  }) => {
    stubSettingsFetch({
      "POST /api/settings/upload": () =>
        failure === "sign"
          ? Response.json({ error: "Signing failed." }, { status: 500 })
          : Response.json({
              signedUrl: "https://storage.example/upload",
              path: "backgrounds/owned.gif",
            }),
      "PUT https://storage.example/upload": () =>
        failure === "store" ? new Response(null, { status: 503 }) : Response.json({}),
      "PUT /api/settings/upload": () =>
        failure === "confirm"
          ? Response.json({ error: "Confirmation failed." }, { status: 500 })
          : Response.json({}),
    });
    render(backgroundSection());

    await userEvent.upload(
      screen.getByLabelText("Upload a background"),
      new File(["gif"], "background.gif", { type: "image/gif" }),
    );

    await waitFor(() => expect(endActivity).toHaveBeenCalledOnce());
    expect(
      sentRequests
        .filter(({ url }) =>
          url.includes("/api/settings/upload") ||
          url === "https://storage.example/upload",
        )
        .map(({ method }) => method),
    ).toEqual(expectedMethods);
    expect(refresh).not.toHaveBeenCalled();
    expect(reportActivity).toHaveBeenLastCalledWith({
      tone: "error",
      message: expectedMessage,
    });
  });

  it("uses slot-specific and unqualified removal endpoints", async () => {
    const paired = render(backgroundSection(PAIR));
    await userEvent.click(
      screen.getByRole("button", { name: /clear the light background/i }),
    );
    await waitFor(() =>
      expect(
        sentRequests.some(
          ({ method, url }) =>
            method === "DELETE" && url === "/api/settings/upload?slot=light",
        ),
      ).toBe(true),
    );

    paired.unmount();
    render(backgroundSection({ backgroundId: "custom" }, { single: "owned.gif" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(
        sentRequests.some(
          ({ method, url }) =>
            method === "DELETE" && url === "/api/settings/upload",
        ),
      ).toBe(true),
    );
  });

  it("holds preview, sends no patch, and restores on toggle-off and unmount", async () => {
    window.localStorage.setItem("xen-theme", "light");
    document.documentElement.dataset.theme = "light";
    const view = render(backgroundSection(PAIR));

    await userEvent.click(
      screen.getByRole("button", { name: /preview the other appearance/i }),
    );
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(patches()).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: /end preview/i }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));

    await userEvent.click(
      screen.getByRole("button", { name: /preview the other appearance/i }),
    );
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    view.unmount();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(patches()).toHaveLength(0);
  });
});
