import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPendingThemeWrite } from "@/components/glass/useTheme";
import { clearPendingTransitions } from "@/components/shell/useOpenWidget";
import type { ImageCropperProps } from "@/components/media/ImageCropper/ImageCropper";
import {
  resetSentRequests,
  sentRequests,
  stubSettingsFetch,
} from "../testFetch";
import { settingsPanel } from "../testSupport";

const routerRefresh = vi.hoisted(() => vi.fn());
const transcodeAnimation = vi.hoisted(() =>
  vi.fn<(original: File) => Promise<File>>(),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

vi.mock("@/widgets/settings/media/transcodeAnimation", () => ({
  transcodeAnimation,
}));

vi.mock("@/components/media/ImageCropper/ImageCropper", () => ({
  ImageCropper: ({ file, label }: ImageCropperProps) => (
    <div role="region" aria-label={`Crop ${label}`}>
      {file.name}
    </div>
  ),
}));

const PAIR = { backgroundLightId: "frost", backgroundDarkId: "orchid" };

function patches() {
  return sentRequests.filter(
    (request) => request.method === "POST" && request.url.endsWith("/api/settings"),
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  resetSentRequests();
  routerRefresh.mockReset();
  transcodeAnimation.mockReset();
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
});

describe("panel-wide workflow coordination (R5, R6, R8)", () => {
  it("renders the workflow sections in their existing order", () => {
    const { container } = render(settingsPanel());

    const sections = Array.from(container.querySelectorAll("section"));
    expect(sections).toHaveLength(7);
    expect(sections.map((section) => section.textContent)).toEqual([
      expect.stringContaining("Background"),
      expect.stringContaining("Appearance schedule"),
      expect.stringContaining("Glass opacity"),
      expect.stringContaining("Avatar"),
      expect.stringContaining("Storage"),
      expect.stringContaining("Listening data"),
      expect.stringContaining("Sign out"),
    ]);
  });

  it("locks every mutation section during an action except Sign out", async () => {
    const storage = deferred<Response>();
    stubSettingsFetch({
      "GET /api/settings/storage": () => storage.promise,
    });
    render(settingsPanel());

    await userEvent.click(screen.getByRole("button", { name: "Check storage" }));

    expect(
      await screen.findByRole("button", { name: "Checking…" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /split into a light and dark pair/i }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Switchover time")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Upload an avatar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run backfill" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();

    storage.resolve(
      Response.json({ ok: true, fault: null, message: "Storage is healthy." }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Check storage" })).toBeEnabled(),
    );
  });

  it("places both success and failure results only beside Sign out", async () => {
    let attempt = 0;
    stubSettingsFetch({
      "GET /api/settings/storage": () => {
        attempt += 1;
        return attempt === 1
          ? Response.json({ ok: true, fault: null, message: "Storage is healthy." })
          : Response.json({ error: "Storage check failed." }, { status: 500 });
      },
    });
    render(settingsPanel());

    await userEvent.click(screen.getByRole("button", { name: "Check storage" }));
    const success = await screen.findByText("Storage is healthy.");
    const accountSection = screen.getByRole("button", { name: "Sign out" }).closest("section");
    expect(success.closest("section")).toBe(accountSection);
    expect(screen.getAllByText("Storage is healthy.")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Check storage" }));
    const failure = await screen.findByText("Storage check failed.");
    expect(failure.closest("section")).toBe(accountSection);
    expect(screen.queryByText("Storage is healthy.")).not.toBeInTheDocument();
    expect(screen.getAllByText("Storage check failed.")).toHaveLength(1);
  });

  it("replaces a pending background crop with the latest avatar crop", async () => {
    const user = userEvent.setup();
    render(settingsPanel());

    await user.upload(
      screen.getByLabelText("Upload a background"),
      new File(["background"], "background.png", { type: "image/png" }),
    );
    expect(screen.getByRole("region", { name: "Crop background" })).toHaveTextContent(
      "background.png",
    );

    const avatarSection = screen.getByText("Avatar").closest("section")!;
    const avatarInput = avatarSection.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(
      avatarInput,
      new File(["avatar"], "avatar.png", { type: "image/png" }),
    );

    expect(screen.queryByRole("region", { name: "Crop background" })).toBeNull();
    expect(screen.getAllByRole("region", { name: /Crop/ })).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Crop avatar" })).toHaveTextContent(
      "avatar.png",
    );
  });
});

describe("workflow transports and maintenance (R6, R8, R9, R10)", () => {
  it("unpairs custom slots light-then-dark and still patches after a delete error", async () => {
    stubSettingsFetch({
      "DELETE /api/settings/upload": (request) =>
        request.url.endsWith("slot=light")
          ? Response.json({ error: "Light delete failed." }, { status: 500 })
          : Response.json({}),
    });
    render(
      settingsPanel(PAIR, {
        light: "https://storage.example/light",
        dark: "https://storage.example/dark",
      }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: /use one background for both/i }),
    );

    await waitFor(() => expect(patches()).toHaveLength(1));
    const operations = sentRequests.filter(
      ({ method }) => method === "DELETE" || method === "POST",
    );
    expect(operations.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "DELETE /api/settings/upload?slot=light",
      "DELETE /api/settings/upload?slot=dark",
      "POST /api/settings",
    ]);
    expect(operations[2].body).toEqual({
      backgroundLightId: null,
      backgroundDarkId: null,
    });
  });

  it("transcodes, signs, stores, confirms, refreshes, and reports a background upload in order", async () => {
    const timeline: string[] = [];
    const encoded = new File(["tiny"], "background.webm", { type: "video/webm" });
    transcodeAnimation.mockImplementation(async () => {
      timeline.push("transcode");
      return encoded;
    });
    routerRefresh.mockImplementation(() => timeline.push("refresh"));
    stubSettingsFetch({
      "POST /api/settings/upload": () => {
        timeline.push("sign");
        return Response.json({
          signedUrl: "https://storage.example/upload",
          path: "backgrounds/owned.webm",
        });
      },
      "PUT https://storage.example/upload": (_request, _input, init) => {
        timeline.push("store");
        expect(init?.body).toBe(encoded);
        return Response.json({});
      },
      "PUT /api/settings/upload": () => {
        timeline.push("confirm");
        return Response.json({});
      },
    });
    render(settingsPanel());

    await userEvent.upload(
      screen.getByLabelText("Upload a background"),
      new File(["a much larger animated file"], "background.gif", {
        type: "image/gif",
      }),
    );

    expect(
      await screen.findByText("Background updated for every visitor."),
    ).toBeInTheDocument();
    expect(timeline).toEqual(["transcode", "sign", "store", "confirm", "refresh"]);
    const uploadRequests = sentRequests.filter(({ url }) =>
      url.includes("/api/settings/upload") || url === "https://storage.example/upload",
    );
    expect(uploadRequests.map(({ method }) => method)).toEqual(["POST", "PUT", "PUT"]);
    expect(uploadRequests[0].body).toEqual({ type: "video/webm", size: encoded.size });
    expect(uploadRequests[2].body).toEqual({ path: "backgrounds/owned.webm" });
  });

  it("validates the transcoded background before requesting a signed upload", async () => {
    transcodeAnimation.mockResolvedValue(
      new File(["invalid"], "background.txt", { type: "text/plain" }),
    );
    render(settingsPanel());

    await userEvent.upload(
      screen.getByLabelText("Upload a background"),
      new File(["gif"], "background.gif", { type: "image/gif" }),
    );

    expect(await screen.findByText(/Unsupported file type/)).toBeInTheDocument();
    expect(
      sentRequests.some(({ url }) => url.startsWith("/api/settings/upload")),
    ).toBe(false);
  });

  it("sends one avatar multipart request before refreshing", async () => {
    const timeline: string[] = [];
    routerRefresh.mockImplementation(() => timeline.push("refresh"));
    stubSettingsFetch({
      "POST /api/settings": (request) => {
        timeline.push("upload");
        expect(request.body).toBeInstanceOf(FormData);
        return Response.json({});
      },
    });
    render(settingsPanel());
    const avatarSection = screen.getByText("Avatar").closest("section")!;
    const input = avatarSection.querySelector('input[type="file"]') as HTMLInputElement;

    await userEvent.upload(
      input,
      new File(["gif"], "avatar.gif", { type: "image/gif" }),
    );

    expect(await screen.findByText("Avatar updated.")).toBeInTheDocument();
    expect(timeline).toEqual(["upload", "refresh"]);
    const uploads = sentRequests.filter(
      ({ method, url }) => method === "POST" && url === "/api/settings",
    );
    expect(uploads).toHaveLength(1);
    expect((uploads[0].body as FormData).get("avatar")).toBeInstanceOf(File);
  });

  it("offers repair only for repairable storage faults and hides it after repair", async () => {
    let check = 0;
    stubSettingsFetch({
      "GET /api/settings/storage": () => {
        check += 1;
        return check === 1
          ? Response.json({ ok: false, fault: "credential", message: "Bad credentials." })
          : Response.json({ ok: false, fault: "bucket", message: "Bucket missing." });
      },
      "POST /api/settings/storage": () =>
        Response.json({ ok: true, fault: null, message: "Bucket created." }),
    });
    render(settingsPanel());

    await userEvent.click(screen.getByRole("button", { name: "Check storage" }));
    expect(await screen.findByText("Bad credentials.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /bucket/i })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Check storage" }));
    expect(await screen.findByText("Bucket missing.")).toBeInTheDocument();
    const repair = screen.getByRole("button", { name: "Create the bucket" });
    await userEvent.click(repair);

    expect(await screen.findByText("Bucket created.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create the bucket" })).toBeNull();
    expect(
      sentRequests.some(
        ({ method, url }) => method === "POST" && url === "/api/settings/storage",
      ),
    ).toBe(true);
  });

  it("keeps a listening job busy until its status refresh completes", async () => {
    const refreshedSettings = deferred<Response>();
    let settingsPoll = 0;
    stubSettingsFetch({
      "POST /api/music/backfill": () => Response.json({ done: false }),
      "GET /api/settings": () => {
        settingsPoll += 1;
        return settingsPoll === 1
          ? Response.json({ settings: {}, backfill: null })
          : refreshedSettings.promise;
      },
    });
    render(settingsPanel());

    await userEvent.click(screen.getByRole("button", { name: "Run backfill" }));

    expect(await screen.findByText("Backfill advanced — run it again to continue.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Upload an avatar" })).toBeDisabled();

    refreshedSettings.resolve(Response.json({ settings: {}, backfill: null }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Run backfill" })).toBeEnabled(),
    );
  });
});

describe("assigning a pair (R8)", () => {
  it("posts exactly one patch carrying both members", async () => {
    render(settingsPanel());

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
    render(settingsPanel({ backgroundId: "orchid" }));

    await userEvent.click(
      screen.getByRole("button", { name: /split into a light and dark pair/i }),
    );

    await waitFor(() => expect(patches()).toHaveLength(1));
    const body = patches()[0].body as Record<string, string>;
    expect(body.backgroundLightId).toBe("frost");
    expect(body.backgroundDarkId).toBe("orchid");
  });

  it("offers a swatch grid per appearance once paired", () => {
    render(settingsPanel(PAIR));

    expect(screen.getByText("Light appearance")).toBeInTheDocument();
    expect(screen.getByText("Dark appearance")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /use the dune background for light/i }),
    ).toBeInTheDocument();
  });

  it("patches one slot when one swatch is pressed", async () => {
    render(settingsPanel(PAIR));

    await userEvent.click(
      screen.getByRole("button", { name: /use the dune background for dark/i }),
    );

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({ backgroundDarkId: "dune" });
  });

  it("clears both slots when the pair is turned back off", async () => {
    render(settingsPanel(PAIR));

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
    render(settingsPanel(PAIR));

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
    stubSettingsFetch({
      "POST /api/settings": () =>
        Response.json(
          {
            error: "A background pair must be two still images.",
            field: "backgroundDarkId",
          },
          { status: 422 },
        ),
    });
    render(settingsPanel(PAIR));

    await userEvent.click(
      screen.getByRole("button", { name: /use the dune background for dark/i }),
    );

    expect(
      await screen.findByText(/two still images/i),
    ).toBeInTheDocument();
  });

  it("clears one slot through the endpoint that reference-counts the bytes", async () => {
    render(settingsPanel(PAIR));

    await userEvent.click(
      screen.getByRole("button", { name: /clear the light background/i }),
    );

    await waitFor(() =>
      expect(
        sentRequests.some(
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
    render(settingsPanel());

    const input = screen.getByLabelText("Switchover time");
    await userEvent.type(input, "19:00");

    await waitFor(() => expect(patches().length).toBeGreaterThan(0));
    expect(patches().at(-1)!.body).toEqual({ themeSwitchoverAt: "19:00" });
  });

  it("clears the schedule rather than posting an empty string", async () => {
    render(settingsPanel({ themeSwitchoverAt: "19:00" }));

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({ themeSwitchoverAt: null });
  });

  it("posts the target appearance on its own", async () => {
    render(settingsPanel({ themeSwitchoverAt: "19:00" }));

    await userEvent.selectOptions(
      screen.getByLabelText("Appearance after the switchover"),
      "light",
    );

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({ themeSwitchoverTo: "light" });
  });

  it("shows a value changed elsewhere rather than a mount-time copy", () => {
    const { rerender } = render(settingsPanel({ themeSwitchoverAt: "19:00" }));
    expect(screen.getByLabelText("Switchover time")).toHaveValue("19:00");

    rerender(settingsPanel({ themeSwitchoverAt: "06:30" }));

    expect(screen.getByLabelText("Switchover time")).toHaveValue("06:30");
  });

  it("describes what the schedule will do, in both directions", () => {
    render(
      settingsPanel({ themeSwitchoverAt: "19:00", themeSwitchoverTo: "dark" }),
    );

    expect(screen.getByText(/19:00 until midnight is dark/)).toBeInTheDocument();
    expect(screen.getByText(/rest of the day is light/)).toBeInTheDocument();
  });
});

describe("preview (R16)", () => {
  it("swaps the whole appearance and posts nothing", async () => {
    document.documentElement.dataset.theme = "light";
    render(settingsPanel(PAIR));

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
    const { unmount } = render(settingsPanel(PAIR));

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
    expect(patches()).toHaveLength(0);
  });

  it("ends when the control is pressed again", async () => {
    window.localStorage.setItem("xen-theme", "light");
    document.documentElement.dataset.theme = "light";
    render(settingsPanel(PAIR));

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
    render(settingsPanel(PAIR));

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
    const { unmount } = render(settingsPanel(PAIR));

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
    const { unmount } = render(settingsPanel(PAIR));

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
