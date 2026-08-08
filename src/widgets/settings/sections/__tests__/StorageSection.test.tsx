import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubSettingsFetch } from "../../testFetch";
import {
  StorageSection,
  type StorageSectionProps,
} from "../StorageSection";

const beginActivity = vi.fn();
const reportActivity = vi.fn();
const endActivity = vi.fn();

function storageSection(overrides: Partial<StorageSectionProps> = {}) {
  return (
    <StorageSection
      busy={null}
      beginActivity={beginActivity}
      reportActivity={reportActivity}
      endActivity={endActivity}
      {...overrides}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  stubSettingsFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StorageSection", () => {
  it("checks storage with no-store and reports the returned result", async () => {
    stubSettingsFetch({
      "GET /api/settings/storage": () =>
        Response.json({ ok: true, fault: null, message: "Storage is healthy." }),
    });
    render(storageSection());

    await userEvent.click(screen.getByRole("button", { name: "Check storage" }));

    await waitFor(() => expect(endActivity).toHaveBeenCalledOnce());
    expect(beginActivity).toHaveBeenCalledWith("storage");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/settings/storage", {
      method: "GET",
      cache: "no-store",
    });
    expect(reportActivity).toHaveBeenLastCalledWith({
      tone: "ok",
      message: "Storage is healthy.",
    });
  });

  it("offers the current repair action for each repairable fault", async () => {
    const faults = [
      ["bucket", "Create the bucket"],
      ["visibility", "Fix the bucket"],
      ["limit", "Fix the bucket"],
      ["types", "Fix the bucket"],
    ] as const;

    for (const [fault, label] of faults) {
      const view = render(storageSection());
      stubSettingsFetch({
        "GET /api/settings/storage": () =>
          Response.json({ ok: false, fault, message: `${fault} fault` }),
      });
      await userEvent.click(screen.getByRole("button", { name: "Check storage" }));
      expect(await screen.findByRole("button", { name: label })).toBeVisible();
      view.unmount();
    }
  });

  it("does not offer repair for a credential fault", async () => {
    stubSettingsFetch({
      "GET /api/settings/storage": () =>
        Response.json({
          ok: false,
          fault: "credential",
          message: "Bad credentials.",
        }),
    });
    render(storageSection());

    await userEvent.click(screen.getByRole("button", { name: "Check storage" }));

    await waitFor(() => expect(endActivity).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: /bucket/i })).toBeNull();
  });

  it("repairs with POST no-store and replaces the fault on success", async () => {
    stubSettingsFetch({
      "GET /api/settings/storage": () =>
        Response.json({ ok: false, fault: "bucket", message: "Bucket missing." }),
      "POST /api/settings/storage": () =>
        Response.json({ ok: true, fault: null, message: "Bucket created." }),
    });
    render(storageSection());

    await userEvent.click(screen.getByRole("button", { name: "Check storage" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Create the bucket" }),
    );

    await waitFor(() => expect(endActivity).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith("/api/settings/storage", {
      method: "POST",
      cache: "no-store",
    });
    expect(screen.queryByRole("button", { name: "Create the bucket" })).toBeNull();
    expect(reportActivity).toHaveBeenLastCalledWith({
      tone: "ok",
      message: "Bucket created.",
    });
  });

  it("clears stale repair state and decodes a failed repair", async () => {
    stubSettingsFetch({
      "GET /api/settings/storage": () =>
        Response.json({
          ok: false,
          fault: "bucket",
          message: "Bucket missing.",
        }),
      "POST /api/settings/storage": () =>
        Response.json({ error: "Storage repair failed." }, { status: 500 }),
    });
    render(storageSection());

    await userEvent.click(screen.getByRole("button", { name: "Check storage" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Create the bucket" }),
    );

    await waitFor(() => expect(endActivity).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Create the bucket" })).toBeNull();
    expect(reportActivity).toHaveBeenLastCalledWith({
      tone: "error",
      message: "Storage repair failed.",
    });
  });
});
