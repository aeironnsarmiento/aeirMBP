import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePendingAsset } from "../usePendingAsset";

describe("usePendingAsset", () => {
  it("replaces the selected asset and clears it on cancel", () => {
    const { result } = renderHook(() => usePendingAsset());
    const background = new File(["background"], "background.png", {
      type: "image/png",
    });
    const avatar = new File(["avatar"], "avatar.png", { type: "image/png" });

    act(() =>
      result.current.selectPendingAsset({
        kind: "background",
        file: background,
        appearance: "dark",
      }),
    );
    act(() =>
      result.current.selectPendingAsset({ kind: "avatar", file: avatar }),
    );

    expect(result.current.pendingAsset).toEqual({ kind: "avatar", file: avatar });

    act(() => result.current.clearPendingAsset());
    expect(result.current.pendingAsset).toBeNull();
  });
});
