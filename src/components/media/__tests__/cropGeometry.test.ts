import { describe, expect, it } from "vitest";
import {
  clampOffset,
  coverScale,
  frameBox,
  offsetBounds,
  outputSize,
  shouldCrop,
  sourceRect,
} from "../cropGeometry";

const square = { width: 400, height: 400 };

describe("cover scale", () => {
  it("scales a wide image by its height, so no edge shows", () => {
    // 800x400 into a 400x400 frame: the height is the binding dimension.
    expect(coverScale({ width: 800, height: 400 }, square)).toBe(1);
    expect(coverScale({ width: 800, height: 200 }, square)).toBe(2);
  });

  it("scales a tall image by its width", () => {
    expect(coverScale({ width: 200, height: 800 }, square)).toBe(2);
  });

  it("enlarges an image smaller than the frame rather than leaving a gap", () => {
    expect(coverScale({ width: 100, height: 100 }, square)).toBe(4);
  });
});

describe("panning bounds", () => {
  it("allows travel only along the axis with something spare to show", () => {
    // 800x400 at scale 1 in a 400x400 frame: 400px spare across, none down.
    const bounds = offsetBounds({ width: 800, height: 400 }, square, 1);

    expect(bounds).toEqual({ x: 200, y: 0 });
  });

  it("refuses to pan an edge into the frame", () => {
    const image = { width: 800, height: 400 };

    expect(clampOffset({ x: 9_999, y: 50 }, image, square, 1)).toEqual({
      x: 200,
      y: 0,
    });
    expect(clampOffset({ x: -9_999, y: -50 }, image, square, 1)).toEqual({
      x: -200,
      y: 0,
    });
  });

  it("leaves an in-range offset alone", () => {
    expect(
      clampOffset({ x: 40, y: 0 }, { width: 800, height: 400 }, square, 1),
    ).toEqual({ x: 40, y: 0 });
  });
});

describe("source rectangle", () => {
  it("takes the centre of the image when nothing has been panned", () => {
    const rect = sourceRect({ width: 800, height: 400 }, square, 1, {
      x: 0,
      y: 0,
    });

    expect(rect).toEqual({ sx: 200, sy: 0, sWidth: 400, sHeight: 400 });
  });

  it("moves the sampled window opposite the drag, as the image follows it", () => {
    const image = { width: 800, height: 400 };

    // Dragging the image right (positive x) reveals more of its left side.
    expect(sourceRect(image, square, 1, { x: 100, y: 0 }).sx).toBe(100);
    expect(sourceRect(image, square, 1, { x: -100, y: 0 }).sx).toBe(300);
  });

  it("halves the sampled region at 2x zoom, still centred", () => {
    const image = { width: 800, height: 800 };

    expect(sourceRect(image, square, 1, { x: 0, y: 0 })).toEqual({
      sx: 200,
      sy: 200,
      sWidth: 400,
      sHeight: 400,
    });
    expect(sourceRect(image, square, 2, { x: 0, y: 0 })).toEqual({
      sx: 300,
      sy: 300,
      sWidth: 200,
      sHeight: 200,
    });
  });

  it("never samples outside the bitmap, whatever the offset asks for", () => {
    const image = { width: 800, height: 400 };

    for (const x of [-100_000, -333, 0, 333, 100_000]) {
      const rect = sourceRect(image, square, 1, { x, y: x });

      expect(rect.sx).toBeGreaterThanOrEqual(0);
      expect(rect.sy).toBeGreaterThanOrEqual(0);
      expect(rect.sx + rect.sWidth).toBeLessThanOrEqual(image.width);
      expect(rect.sy + rect.sHeight).toBeLessThanOrEqual(image.height);
    }
  });
});

describe("output size", () => {
  it("caps the long edge and keeps the crop's aspect", () => {
    const size = outputSize(
      { sx: 0, sy: 0, sWidth: 4_000, sHeight: 2_250 },
      2_560,
    );

    expect(size).toEqual({ width: 2_560, height: 1_440 });
  });

  it("never upscales a crop smaller than the cap", () => {
    const size = outputSize({ sx: 0, sy: 0, sWidth: 300, sHeight: 300 }, 512);

    expect(size).toEqual({ width: 300, height: 300 });
  });

  it("stays at least one pixel on a degenerate crop", () => {
    const size = outputSize({ sx: 0, sy: 0, sWidth: 0.2, sHeight: 0.2 }, 512);

    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });
});

describe("frame box", () => {
  it("fits a 16:9 frame to the width when the space is tall", () => {
    expect(frameBox(16 / 9, { width: 640, height: 640 })).toEqual({
      width: 640,
      height: 360,
    });
  });

  it("fits to the height when the space is wide", () => {
    expect(frameBox(1, { width: 900, height: 300 })).toEqual({
      width: 300,
      height: 300,
    });
  });
});

describe("what gets cropped", () => {
  it("sends still images through the cropper", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/avif"]) {
      expect(shouldCrop(type)).toBe(true);
    }
  });

  it("leaves a GIF alone, because a canvas crop would keep one frame", () => {
    expect(shouldCrop("image/gif")).toBe(false);
  });
});
