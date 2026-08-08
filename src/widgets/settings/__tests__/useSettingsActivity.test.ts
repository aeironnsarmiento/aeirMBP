import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSettingsActivity } from "../useSettingsActivity";

describe("useSettingsActivity", () => {
  it("owns the begin, report, and end lifecycle without ending implicitly", () => {
    const { result } = renderHook(() => useSettingsActivity());

    act(() =>
      result.current.reportActivity({
        tone: "ok",
        message: "Previous action complete.",
      }),
    );
    expect(result.current.status).toEqual({
      tone: "ok",
      message: "Previous action complete.",
    });

    act(() => result.current.beginActivity("Backfill"));
    expect(result.current.busy).toBe("Backfill");
    expect(result.current.status).toBeNull();

    act(() =>
      result.current.reportActivity({
        tone: "ok",
        message: "Backfill advanced — run it again to continue.",
      }),
    );
    expect(result.current.busy).toBe("Backfill");
    expect(result.current.status).toEqual({
      tone: "ok",
      message: "Backfill advanced — run it again to continue.",
    });

    act(() => result.current.endActivity());
    expect(result.current.busy).toBeNull();
  });

  it("publishes a supplied failure and always allows the owner to end", () => {
    const { result } = renderHook(() => useSettingsActivity());

    act(() => result.current.beginActivity("storage"));
    act(() =>
      result.current.reportActivity({
        tone: "error",
        message: "Storage check failed.",
      }),
    );
    act(() => result.current.endActivity());

    expect(result.current.busy).toBeNull();
    expect(result.current.status).toEqual({
      tone: "error",
      message: "Storage check failed.",
    });
  });
});
