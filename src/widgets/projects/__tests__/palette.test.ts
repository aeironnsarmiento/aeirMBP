import { describe, expect, it } from "vitest";
import { hueFor } from "@/widgets/music/format";
import type { Project } from "../data";
import { swatchStops, swatchStyle } from "../palette";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "moonbites",
    title: "moonbites",
    description: "A recipe URL scraper and cookbook.",
    previewUrl: null,
    href: "https://moonbites-blue.vercel.app",
    ...overrides,
  };
}

describe("swatchStops", () => {
  it("paints a committed palette so the chip carries the real site's colours", () => {
    const stops = swatchStops(
      project({ palette: { accent: "#68784a", surface: "#f0f4e2" } }),
    );

    expect(stops).toEqual({ from: "#f0f4e2", to: "#68784a" });
  });

  it("leads with the surface so the palette reads light-to-dark like the fallback", () => {
    const { from, to } = swatchStops(
      project({ palette: { accent: "#68784a", surface: "#f0f4e2" } }),
    );
    const { from: fallbackFrom, to: fallbackTo } = swatchStops(project());

    // Both branches must agree on which end is lit, or a project gains a
    // palette and the swatch flips its lighting direction.
    expect(fallbackFrom).toContain("0.7");
    expect(fallbackTo).toContain("0.48");
    expect(from).not.toBe(to);
  });

  it("falls back to the id-derived hue when no palette has been sampled yet", () => {
    const hue = hueFor("moonbites");

    expect(swatchStops(project())).toEqual({
      from: `oklch(0.7 0.12 ${hue})`,
      to: `oklch(0.48 0.14 ${hue + 55})`,
    });
  });

  it("keeps the fallback stable for a given id", () => {
    expect(swatchStops(project())).toEqual(swatchStops(project()));
  });

  it("gives different projects different fallback swatches", () => {
    expect(swatchStops(project({ id: "one" }))).not.toEqual(
      swatchStops(project({ id: "two" })),
    );
  });
});

describe("swatchStyle", () => {
  it("exposes the stops as the custom properties the stylesheet consumes", () => {
    const style = swatchStyle(
      project({ palette: { accent: "#68784a", surface: "#f0f4e2" } }),
    );

    expect(style).toEqual({ "--swatch-from": "#f0f4e2", "--swatch-to": "#68784a" });
  });
});
