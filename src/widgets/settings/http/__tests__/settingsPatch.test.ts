import { afterEach, describe, expect, it, vi } from "vitest";
import { postSettingsPatch } from "../settingsPatch";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postSettingsPatch", () => {
  it("posts the serialized settings patch as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    const patch = { themeSwitchoverAt: "19:00" };

    await expect(postSettingsPatch(patch)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  });

  it("rejects with the decoded response error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { error: "Schedule rejected." },
          { status: 422 },
        ),
      ),
    );

    await expect(
      postSettingsPatch({ themeSwitchoverTo: "light" }),
    ).rejects.toThrow("Schedule rejected.");
  });
});
