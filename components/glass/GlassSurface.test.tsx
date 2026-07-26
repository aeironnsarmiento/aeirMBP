import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BLUR_DEPTH_CEILING, GlassSurface } from "./GlassSurface";

describe("blur-layer ceiling (R6)", () => {
  it("blurs the outermost surface", () => {
    render(<GlassSurface data-testid="outer">panel</GlassSurface>);

    expect(screen.getByTestId("outer")).toHaveAttribute("data-blur", "on");
  });

  it("does not add a backdrop filter to a surface nested past the ceiling", () => {
    render(
      <GlassSurface data-testid="outer">
        <GlassSurface data-testid="inner">
          <GlassSurface data-testid="innermost">nested</GlassSurface>
        </GlassSurface>
      </GlassSurface>,
    );

    expect(screen.getByTestId("outer")).toHaveAttribute("data-blur", "on");
    expect(screen.getByTestId("inner")).toHaveAttribute("data-blur", "off");
    expect(screen.getByTestId("innermost")).toHaveAttribute("data-blur", "off");
  });

  it("counts depth so the ceiling is inspectable from the DOM", () => {
    render(
      <GlassSurface data-testid="outer">
        <GlassSurface data-testid="inner">nested</GlassSurface>
      </GlassSurface>,
    );

    expect(screen.getByTestId("outer")).toHaveAttribute("data-glass-depth", "1");
    expect(screen.getByTestId("inner")).toHaveAttribute("data-glass-depth", "2");
    expect(BLUR_DEPTH_CEILING).toBe(1);
  });

  it("blurs sibling surfaces independently — the ceiling bounds nesting, not count", () => {
    render(
      <div>
        <GlassSurface data-testid="a">a</GlassSurface>
        <GlassSurface data-testid="b">b</GlassSurface>
        <GlassSurface data-testid="c">c</GlassSurface>
      </div>,
    );

    for (const id of ["a", "b", "c"]) {
      expect(screen.getByTestId(id)).toHaveAttribute("data-blur", "on");
    }
  });

  it("suppresses the filter on every surface inside a frame, however deep", () => {
    // The shape the shell now renders: one frame, siblings inside it, and a
    // nested surface inside one of those.
    render(
      <GlassSurface data-testid="frame">
        <GlassSurface data-testid="sidebar">nav</GlassSurface>
        <GlassSurface data-testid="card">
          <GlassSurface data-testid="well">stat</GlassSurface>
        </GlassSurface>
      </GlassSurface>,
    );

    expect(screen.getByTestId("frame")).toHaveAttribute("data-blur", "on");
    for (const id of ["sidebar", "card", "well"]) {
      expect(screen.getByTestId(id)).toHaveAttribute("data-blur", "off");
    }
  });
});
