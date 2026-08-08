import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetSentRequests,
  sentRequests,
  stubSettingsFetch,
} from "../../testFetch";
import {
  AppearanceScheduleSection,
  type AppearanceScheduleSectionProps,
} from "../AppearanceScheduleSection/AppearanceScheduleSection";

const beginActivity = vi.fn();
const reportActivity = vi.fn();
const endActivity = vi.fn();
const refresh = vi.fn();

function scheduleSection(
  overrides: Partial<AppearanceScheduleSectionProps> = {},
) {
  return (
    <AppearanceScheduleSection
      themeSwitchoverAt={null}
      themeSwitchoverTo="dark"
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

describe("AppearanceScheduleSection", () => {
  it("posts a valid time and clears an existing time with null", async () => {
    const first = render(scheduleSection());

    fireEvent.change(screen.getByLabelText("Switchover time"), {
      target: { value: "19:00" },
    });
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({ themeSwitchoverAt: "19:00" });
    expect(beginActivity).toHaveBeenCalledWith("schedule");
    expect(refresh).toHaveBeenCalledOnce();

    first.unmount();
    resetSentRequests();
    render(scheduleSection({ themeSwitchoverAt: "19:00" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({ themeSwitchoverAt: null });
  });

  it("reports the field-specific validation error without a request", () => {
    const input = render(scheduleSection()).getByLabelText("Switchover time");
    Object.defineProperty(input, "value", {
      configurable: true,
      value: "24:00",
    });

    fireEvent.change(input);

    expect(patches()).toHaveLength(0);
    expect(beginActivity).not.toHaveBeenCalled();
    expect(reportActivity).toHaveBeenCalledWith({
      tone: "error",
      message:
        "Switchover time must be HH:MM between 00:00 and 23:59 (themeSwitchoverAt).",
    });
  });

  it("posts only the selected target appearance", async () => {
    render(scheduleSection({ themeSwitchoverAt: "19:00" }));

    await userEvent.selectOptions(
      screen.getByLabelText("Appearance after the switchover"),
      "light",
    );

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({ themeSwitchoverTo: "light" });
  });

  it("replaces the keyed uncontrolled input when the external value changes", () => {
    const view = render(scheduleSection({ themeSwitchoverAt: "19:00" }));
    const firstInput = screen.getByLabelText("Switchover time");
    expect(firstInput).toHaveValue("19:00");

    view.rerender(scheduleSection({ themeSwitchoverAt: "06:30" }));

    const nextInput = screen.getByLabelText("Switchover time");
    expect(nextInput).toHaveValue("06:30");
    expect(nextInput).not.toBe(firstInput);
  });

  it("disables every schedule control while another action is busy", () => {
    render(
      scheduleSection({ themeSwitchoverAt: "19:00", busy: "storage" }),
    );

    expect(screen.getByLabelText("Switchover time")).toBeDisabled();
    expect(
      screen.getByLabelText("Appearance after the switchover"),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("keeps the existing response error and refresh timing", async () => {
    stubSettingsFetch({
      "POST /api/settings": () =>
        Response.json({ error: "Schedule rejected." }, { status: 500 }),
    });
    render(scheduleSection());

    fireEvent.change(screen.getByLabelText("Switchover time"), {
      target: { value: "19:00" },
    });

    await waitFor(() => expect(endActivity).toHaveBeenCalledOnce());
    expect(reportActivity).toHaveBeenLastCalledWith({
      tone: "error",
      message: "Schedule rejected.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
