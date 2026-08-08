import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetSentRequests,
  sentRequests,
  stubSettingsFetch,
} from "../../testFetch";
import {
  GlassOpacitySection,
  type GlassOpacitySectionProps,
} from "../GlassOpacitySection/GlassOpacitySection";

const beginActivity = vi.fn();
const reportActivity = vi.fn();
const endActivity = vi.fn();
const refresh = vi.fn();

function opacitySection(overrides: Partial<GlassOpacitySectionProps> = {}) {
  return (
    <GlassOpacitySection
      frameOpacity={0.55}
      paneOpacity={0.55}
      busy={null}
      beginActivity={beginActivity}
      reportActivity={reportActivity}
      endActivity={endActivity}
      refresh={refresh}
      {...overrides}
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
  stubSettingsFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GlassOpacitySection", () => {
  it("keeps frame and pane display drafts independent", () => {
    render(opacitySection());

    fireEvent.change(screen.getByLabelText("Frame opacity"), {
      target: { value: "0.61" },
    });

    expect(screen.getByLabelText("Frame opacity")).toHaveValue("0.61");
    expect(screen.getByLabelText("Panes opacity")).toHaveValue("0.55");
    expect(screen.getByText("0.61")).toBeInTheDocument();
    expect(screen.getByText("0.55")).toBeInTheDocument();
    expect(patches()).toHaveLength(0);
  });

  it("commits the current frame draft on pointer-up", async () => {
    render(opacitySection());
    const frame = screen.getByLabelText("Frame opacity");

    fireEvent.change(frame, { target: { value: "0.62" } });
    fireEvent.pointerUp(frame);

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({ frameOpacity: 0.62 });
    expect(beginActivity).toHaveBeenCalledWith("opacity");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("commits the current pane draft on key-up", async () => {
    render(opacitySection());
    const panes = screen.getByLabelText("Panes opacity");

    fireEvent.change(panes, { target: { value: "0.48" } });
    fireEvent.keyUp(panes, { key: "ArrowLeft" });

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({ paneOpacity: 0.48 });
  });

  it("disables both sliders while another action is busy", () => {
    render(opacitySection({ busy: "schedule" }));

    expect(screen.getByLabelText("Frame opacity")).toBeDisabled();
    expect(screen.getByLabelText("Panes opacity")).toBeDisabled();
  });

  it("keeps the existing response error and refresh timing", async () => {
    stubSettingsFetch({
      "POST /api/settings": () =>
        Response.json({ error: "Opacity rejected." }, { status: 500 }),
    });
    render(opacitySection());
    const frame = screen.getByLabelText("Frame opacity");

    fireEvent.change(frame, { target: { value: "0.62" } });
    fireEvent.pointerUp(frame);

    await waitFor(() => expect(endActivity).toHaveBeenCalledOnce());
    expect(reportActivity).toHaveBeenLastCalledWith({
      tone: "error",
      message: "Opacity rejected.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
