import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubSettingsFetch } from "../../testFetch";
import { AccountSection } from "../AccountSection";

const refresh = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  stubSettingsFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AccountSection", () => {
  it("signs out with DELETE and refreshes afterward", async () => {
    const timeline: string[] = [];
    stubSettingsFetch({
      "DELETE /api/auth": () => {
        timeline.push("delete");
        return Response.json({}, { status: 500 });
      },
    });
    refresh.mockImplementation(() => timeline.push("refresh"));
    render(<AccountSection status={null} refresh={refresh} />);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/auth", {
      method: "DELETE",
    });
    expect(timeline).toEqual(["delete", "refresh"]);
  });

  it("renders the shared status once beside Sign out with its tone", () => {
    render(
      <AccountSection
        status={{ tone: "error", message: "Could not save settings." }}
        refresh={refresh}
      />,
    );

    const signOut = screen.getByRole("button", { name: "Sign out" });
    const status = screen.getByText("Could not save settings.");
    expect(status).toHaveAttribute("data-tone", "error");
    expect(status.closest("section")).toBe(signOut.closest("section"));
    expect(screen.getAllByText("Could not save settings.")).toHaveLength(1);
  });
});
