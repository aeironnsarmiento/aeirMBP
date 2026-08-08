import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubSettingsFetch } from "../../testFetch";
import {
  ListeningDataSection,
  type ListeningDataSectionProps,
} from "../ListeningDataSection/ListeningDataSection";

const beginActivity = vi.fn();
const reportActivity = vi.fn();
const endActivity = vi.fn();

function listeningSection(overrides: Partial<ListeningDataSectionProps> = {}) {
  return (
    <ListeningDataSection
      busy={null}
      beginActivity={beginActivity}
      reportActivity={reportActivity}
      endActivity={endActivity}
      {...overrides}
    />
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
  vi.clearAllMocks();
  stubSettingsFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ListeningDataSection", () => {
  it("loads both statuses with no-store on mount and renders the empty state", async () => {
    stubSettingsFetch({
      "GET /api/settings": () =>
        Response.json({ settings: {}, backfill: null }),
      "GET /api/music/enrich": () =>
        Response.json({ tracks: 0, artists: 0 }),
    });

    render(listeningSection());

    expect(await screen.findByText("enrichment")).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/settings", {
      cache: "no-store",
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/music/enrich", {
      cache: "no-store",
    });
    expect(screen.getByText("backfill · idle")).toBeInTheDocument();
    expect(screen.getByText("complete")).toBeInTheDocument();
  });

  it("renders progress, pending enrichment, and the last backfill error", async () => {
    stubSettingsFetch({
      "GET /api/settings": () =>
        Response.json({
          settings: {},
          backfill: {
            status: "running",
            page: 3,
            totalPages: 4,
            insertedTotal: 100,
            storedScrobbles: 1234,
            lastRunAt: "2026-08-07T12:00:00.000Z",
            lastError: "Last.fm timed out.",
          },
        }),
      "GET /api/music/enrich": () =>
        Response.json({ tracks: 12, artists: 3 }),
    });

    const { container } = render(listeningSection());

    expect(await screen.findByText("backfill · running")).toBeInTheDocument();
    expect(screen.getByText("page 3 / 4 · 1,234 stored")).toBeInTheDocument();
    expect(
      screen.getByText("12 tracks · 3 artists pending"),
    ).toBeInTheDocument();
    expect(screen.getByText("last error")).toBeInTheDocument();
    expect(screen.getByText("Last.fm timed out.")).toBeInTheDocument();
    expect(container.querySelector('[style="width: 50%;"]')).not.toBeNull();
  });

  it.each([
    ["Run backfill", "/api/music/backfill", "Backfill", true, "Backfill complete."],
    [
      "Run enrichment",
      "/api/music/enrich",
      "Enrichment",
      false,
      "Enrichment advanced — run it again to continue.",
    ],
  ])(
    "runs %s and preserves its terminal wording",
    async (buttonName, path, label, done, message) => {
      stubSettingsFetch({
        [`POST ${path}`]: () => Response.json({ done }),
      });
      render(listeningSection());

      await userEvent.click(screen.getByRole("button", { name: buttonName }));

      await waitFor(() => expect(endActivity).toHaveBeenCalledOnce());
      expect(beginActivity).toHaveBeenCalledWith(label);
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(path, { method: "POST" });
      expect(reportActivity).toHaveBeenCalledWith({ tone: "ok", message });
      expect(endActivity).toHaveBeenCalledOnce();
    },
  );

  it("keeps the job active until its status refresh completes", async () => {
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
    render(listeningSection());
    await waitFor(() => expect(settingsPoll).toBe(1));

    await userEvent.click(screen.getByRole("button", { name: "Run backfill" }));

    await waitFor(() =>
      expect(reportActivity).toHaveBeenCalledWith({
        tone: "ok",
        message: "Backfill advanced — run it again to continue.",
      }),
    );
    expect(endActivity).not.toHaveBeenCalled();

    refreshedSettings.resolve(Response.json({ settings: {}, backfill: null }));
    await waitFor(() => expect(endActivity).toHaveBeenCalledOnce());
  });

  it("refreshes status manually without changing the shared activity status", async () => {
    render(listeningSection());
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));

    await userEvent.click(screen.getByRole("button", { name: "Refresh status" }));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4));
    expect(beginActivity).not.toHaveBeenCalled();
    expect(reportActivity).not.toHaveBeenCalled();
    expect(endActivity).not.toHaveBeenCalled();
  });

  it("reports a decoded job failure and clears the activity", async () => {
    stubSettingsFetch({
      "POST /api/music/enrich": () =>
        Response.json({ error: "Enrichment failed upstream." }, { status: 502 }),
    });
    render(listeningSection());

    await userEvent.click(
      screen.getByRole("button", { name: "Run enrichment" }),
    );

    await waitFor(() => expect(endActivity).toHaveBeenCalledOnce());
    expect(reportActivity).toHaveBeenCalledWith({
      tone: "error",
      message: "Enrichment failed upstream.",
    });
  });

  it("preserves the current busy labels and whole-section lock", () => {
    const { rerender } = render(listeningSection({ busy: "Backfill" }));

    expect(screen.getByRole("button", { name: "Importing…" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Run enrichment" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Refresh status" })).toBeDisabled();

    rerender(listeningSection({ busy: "Enrichment" }));
    expect(screen.getByRole("button", { name: "Enriching…" })).toBeDisabled();
  });
});
