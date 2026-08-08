import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageCropperProps } from "@/components/media/ImageCropper/ImageCropper";
import {
  resetSentRequests,
  sentRequests,
  stubSettingsFetch,
} from "../../testFetch";
import {
  AvatarSection,
  type AvatarSectionProps,
} from "../AvatarSection/AvatarSection";

vi.mock("@/components/media/ImageCropper/ImageCropper", () => ({
  ImageCropper: (props: ImageCropperProps) => (
    <div role="region" aria-label={`Crop ${props.label}`}>
      <span>{`${props.aspect}:${props.maxWidth}:${props.confirmLabel}`}</span>
      <button
        type="button"
        onClick={() =>
          props.onCommit(
            new File(["cropped"], "avatar.webp", { type: "image/webp" }),
          )
        }
      >
        Commit crop
      </button>
    </div>
  ),
}));

const beginActivity = vi.fn();
const reportActivity = vi.fn();
const endActivity = vi.fn();
const selectPendingAsset = vi.fn();
const clearPendingAsset = vi.fn();
const refresh = vi.fn();

function avatarSection(overrides: Partial<AvatarSectionProps> = {}) {
  return (
    <AvatarSection
      avatarUrl={null}
      busy={null}
      pendingAsset={null}
      beginActivity={beginActivity}
      reportActivity={reportActivity}
      endActivity={endActivity}
      selectPendingAsset={selectPendingAsset}
      clearPendingAsset={clearPendingAsset}
      refresh={refresh}
      {...overrides}
    />
  );
}

function avatarInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  resetSentRequests();
  vi.clearAllMocks();
  stubSettingsFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AvatarSection", () => {
  it("opens the square crop flow and uploads the committed crop once", async () => {
    const original = new File(["avatar"], "portrait.png", {
      type: "image/png",
    });
    const view = render(avatarSection());

    await userEvent.upload(avatarInput(view.container), original);
    expect(selectPendingAsset).toHaveBeenCalledWith({
      kind: "avatar",
      file: original,
    });

    view.rerender(
      avatarSection({ pendingAsset: { kind: "avatar", file: original } }),
    );
    expect(screen.getByRole("region", { name: "Crop avatar" })).toHaveTextContent(
      "1:512:Use this avatar",
    );
    await userEvent.click(screen.getByRole("button", { name: "Commit crop" }));

    await waitFor(() => expect(endActivity).toHaveBeenCalledOnce());
    expect(clearPendingAsset).toHaveBeenCalledOnce();
    const uploads = sentRequests.filter(
      ({ method, url }) => method === "POST" && url === "/api/settings",
    );
    expect(uploads).toHaveLength(1);
    expect((uploads[0].body as FormData).get("avatar")).toEqual(
      expect.objectContaining({ name: "avatar.webp", type: "image/webp" }),
    );
  });

  it("bypasses cropping for an animated avatar and uploads it directly", async () => {
    const animated = new File(["gif"], "animated.gif", { type: "image/gif" });
    const view = render(avatarSection());

    await userEvent.upload(avatarInput(view.container), animated);

    await waitFor(() => expect(endActivity).toHaveBeenCalledOnce());
    expect(selectPendingAsset).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Crop avatar" })).toBeNull();
    const upload = sentRequests.find(
      ({ method, url }) => method === "POST" && url === "/api/settings",
    );
    expect((upload?.body as FormData).get("avatar")).toBe(animated);
  });

  it("reports success, refreshes after the request, and preserves the preview", async () => {
    const timeline: string[] = [];
    refresh.mockImplementation(() => timeline.push("refresh"));
    stubSettingsFetch({
      "POST /api/settings": () => {
        timeline.push("upload");
        return Response.json({});
      },
    });
    const view = render(
      avatarSection({ avatarUrl: "https://storage.example/avatar.webp" }),
    );

    expect(view.container.querySelector("img")).toHaveAttribute(
      "src",
      "https://storage.example/avatar.webp",
    );
    await userEvent.upload(
      avatarInput(view.container),
      new File(["gif"], "animated.gif", { type: "image/gif" }),
    );

    await waitFor(() => expect(endActivity).toHaveBeenCalledOnce());
    expect(beginActivity).toHaveBeenCalledWith("avatar");
    expect(reportActivity).toHaveBeenLastCalledWith({
      tone: "ok",
      message: "Avatar updated.",
    });
    expect(timeline).toEqual(["upload", "refresh"]);
  });

  it("decodes upload failures without refreshing and clears the busy state", async () => {
    stubSettingsFetch({
      "POST /api/settings": () =>
        Response.json({ error: "Avatar rejected." }, { status: 422 }),
    });
    const view = render(avatarSection());

    await userEvent.upload(
      avatarInput(view.container),
      new File(["gif"], "animated.gif", { type: "image/gif" }),
    );

    await waitFor(() => expect(endActivity).toHaveBeenCalledOnce());
    expect(reportActivity).toHaveBeenLastCalledWith({
      tone: "error",
      message: "Avatar rejected.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
