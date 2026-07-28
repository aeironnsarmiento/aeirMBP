import { describe, expect, it } from "vitest";
import {
  BACKGROUNDS,
  CUSTOM_BACKGROUND_ID,
  DEFAULT_BACKGROUND_ID,
  backgroundById,
} from "./backgrounds";

const SUPABASE = "https://example.supabase.co/storage/v1/object/public/site-assets/background";

describe("resolving the owner's own background", () => {
  it("reports an uploaded video as a video, so the shell renders an element", () => {
    // Storage hands back a path, not a MIME type — the extension is the only signal.
    const background = backgroundById(CUSTOM_BACKGROUND_ID, `${SUPABASE}/1785098905808.mp4`);
    expect(background.kind).toBe("video");
  });

  it("treats webm as a video too", () => {
    expect(backgroundById(CUSTOM_BACKGROUND_ID, `${SUPABASE}/a.webm`).kind).toBe("video");
  });

  it("still reports a stored image as an image", () => {
    expect(backgroundById(CUSTOM_BACKGROUND_ID, `${SUPABASE}/a.gif`).kind).toBe("image");
    expect(backgroundById(CUSTOM_BACKGROUND_ID, `${SUPABASE}/a.webp`).kind).toBe("image");
  });

  it("reads the extension through a query string", () => {
    expect(backgroundById(CUSTOM_BACKGROUND_ID, `${SUPABASE}/a.mp4?v=2`).kind).toBe("video");
  });

  it("falls back to the default when custom is selected with nothing uploaded", () => {
    const background = backgroundById(CUSTOM_BACKGROUND_ID, null);
    expect(background.id).toBe(DEFAULT_BACKGROUND_ID);
    expect(background.kind).toBe("image");
  });
});

describe("the committed set", () => {
  it("is all stills — a preset must never cost a decode loop", () => {
    expect(BACKGROUNDS.every((background) => background.kind === "image")).toBe(true);
  });

  it("falls back to the default for an unknown id", () => {
    expect(backgroundById("nope").id).toBe(DEFAULT_BACKGROUND_ID);
  });
});
