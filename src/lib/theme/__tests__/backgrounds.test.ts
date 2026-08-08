import { describe, expect, it } from "vitest";
import {
  BACKGROUNDS,
  CUSTOM_BACKGROUND_ID,
  DEFAULT_BACKGROUND_ID,
  backgroundById,
  backgroundForAppearance,
  hasBackgroundPair,
  type BackgroundSlots,
} from "../backgrounds";

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

function slots(overrides: Partial<BackgroundSlots> = {}): BackgroundSlots {
  return {
    single: { id: DEFAULT_BACKGROUND_ID, customUrl: null },
    light: { id: null, customUrl: null },
    dark: { id: null, customUrl: null },
    ...overrides,
  };
}

describe("resolving a background for an appearance (R8)", () => {
  it("uses one source for both modes when no pair is configured (AE2)", () => {
    const configured = slots({ single: { id: "dune", customUrl: null } });

    expect(backgroundForAppearance("light", configured).src).toBe(
      backgroundForAppearance("dark", configured).src,
    );
    expect(backgroundForAppearance("light", configured).id).toBe("dune");
  });

  it("keeps an uploaded single background across a mode switch (AE2)", () => {
    const configured = slots({
      single: { id: CUSTOM_BACKGROUND_ID, customUrl: `${SUPABASE}/one.mp4` },
    });

    expect(backgroundForAppearance("light", configured).src).toBe(
      `${SUPABASE}/one.mp4`,
    );
    expect(backgroundForAppearance("dark", configured).src).toBe(
      `${SUPABASE}/one.mp4`,
    );
  });

  it("returns different sources for a configured pair (AE3)", () => {
    const configured = slots({
      light: { id: "frost", customUrl: null },
      dark: { id: "orchid", customUrl: null },
    });

    expect(backgroundForAppearance("light", configured).id).toBe("frost");
    expect(backgroundForAppearance("dark", configured).id).toBe("orchid");
  });

  it("fills an emptied slot with a mood-matched preset, not the dark default (AE3)", () => {
    const configured = slots({ dark: { id: "orchid", customUrl: null } });

    const light = backgroundForAppearance("light", configured);

    expect(backgroundForAppearance("dark", configured).id).toBe("orchid");
    expect(light.mood).toBe("light");
    expect(light.id).not.toBe(DEFAULT_BACKGROUND_ID);
    expect(light.id).not.toBe("orchid");
  });

  it("fills an emptied dark slot with a dark-mood preset", () => {
    const configured = slots({ light: { id: "frost", customUrl: null } });

    expect(backgroundForAppearance("dark", configured).mood).toBe("dark");
  });

  it("does not let the single background stand in for a half-emptied pair", () => {
    // The single value is still stored; the pair is what the owner is running.
    const configured = slots({
      single: { id: "dune", customUrl: null },
      dark: { id: "orchid", customUrl: null },
    });

    expect(backgroundForAppearance("light", configured).id).not.toBe("dune");
  });

  it("reports whether a pair is configured at all", () => {
    expect(hasBackgroundPair(slots())).toBe(false);
    expect(hasBackgroundPair(slots({ light: { id: "frost", customUrl: null } }))).toBe(
      true,
    );
  });

  it("resolves each slot's own upload", () => {
    const configured = slots({
      light: { id: CUSTOM_BACKGROUND_ID, customUrl: `${SUPABASE}/day.png` },
      dark: { id: CUSTOM_BACKGROUND_ID, customUrl: `${SUPABASE}/night.png` },
    });

    expect(backgroundForAppearance("light", configured).src).toBe(
      `${SUPABASE}/day.png`,
    );
    expect(backgroundForAppearance("dark", configured).src).toBe(
      `${SUPABASE}/night.png`,
    );
  });
});
