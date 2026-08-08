import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Summary } from "../expanded/expanded";
import type { MusicSummary } from "../queries/aggregations";

function summary(overrides: Partial<MusicSummary> = {}): MusicSummary {
  return {
    scrobblesThisWeek: 1_887,
    perDayAverage: 269.6,
    totalScrobbles: 7_671,
    uniqueArtists: 149,
    uniqueTracks: 815,
    listeningMinutes: 30_153,
    playsWithoutDuration: 67,
    firstScrobbleAt: new Date("2026-07-02T13:52:29Z"),
    lastScrobbleAt: new Date("2026-07-27T00:56:36Z"),
    ...overrides,
  };
}

/** The listening-time card is the only stat that is a control. */
const toggle = () => screen.getByRole("button", { name: /listening time/i });

describe("the listening-time card", () => {
  it("shows the rounded figure at rest (R9)", () => {
    render(<Summary data={summary()} />);

    expect(screen.getByText("20d 22h")).toBeInTheDocument();
  });

  it("switches to whole minutes when activated (R10)", async () => {
    const user = userEvent.setup();
    render(<Summary data={summary()} />);

    await user.click(toggle());

    expect(screen.getByText("30,153")).toBeInTheDocument();
    expect(screen.getByText("Minutes listened")).toBeInTheDocument();
    expect(screen.queryByText("20d 22h")).not.toBeInTheDocument();
  });

  it("carries no exclusion note, even with plays that have no duration", async () => {
    const user = userEvent.setup();
    // The card used to append "{n} plays excluded, no duration" beside the
    // exact figure. That note was dropped; the count is still aggregated,
    // it is just no longer surfaced on the card.
    render(<Summary data={summary({ playsWithoutDuration: 67 })} />);

    await user.click(toggle());

    expect(screen.getByText("30,153")).toBeInTheDocument();
    expect(screen.queryByText(/plays excluded/i)).not.toBeInTheDocument();
  });

  it("switches back", async () => {
    const user = userEvent.setup();
    render(<Summary data={summary()} />);

    await user.click(toggle());
    await user.click(toggle());

    expect(screen.getByText("20d 22h")).toBeInTheDocument();
  });

  it("is reachable and operable from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Summary data={summary()} />);

    await user.tab();
    expect(toggle()).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.getByText("30,153")).toBeInTheDocument();

    await user.keyboard(" ");
    expect(screen.getByText("20d 22h")).toBeInTheDocument();
  });

  it("names the action rather than only the value, and exposes its state", async () => {
    const user = userEvent.setup();
    render(<Summary data={summary()} />);

    // A toggle whose accessible name is just its current reading tells a
    // screen-reader user nothing about what activating it does.
    expect(toggle()).toHaveAccessibleName(/show exact minutes/i);
    expect(toggle()).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle());

    expect(toggle()).toHaveAccessibleName(/show rounded/i);
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
  });
});

describe("the other three stats", () => {
  it("stay static rather than becoming controls", () => {
    render(<Summary data={summary()} />);

    // Exactly one button in the strip. Making all four interactive would
    // promise behaviour the other three do not have.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("1,887")).toBeInTheDocument();
    expect(screen.getByText("269.6")).toBeInTheDocument();
    expect(screen.getByText("149")).toBeInTheDocument();
  });
});
