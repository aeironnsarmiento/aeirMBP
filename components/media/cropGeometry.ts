/**
 * Crop geometry.
 *
 * Pure arithmetic, deliberately free of React and of the DOM: jsdom runs no
 * cascade and has no canvas, so the only way a crop can be verified in this
 * suite is by keeping the maths out of the component. `ImageCropper` owns the
 * pointer handling and the canvas call; every number it uses comes from here.
 *
 * The model: the image is drawn scaled by `scale` and centred in the crop
 * frame, then translated by `offset`. A positive offset.x moves the image
 * right, revealing more of its left edge.
 */

export type Size = { width: number; height: number };
export type Offset = { x: number; y: number };
export type SourceRect = {
  sx: number;
  sy: number;
  sWidth: number;
  sHeight: number;
};

/**
 * The smallest scale at which the image still covers the whole frame.
 *
 * Zooming below this would expose empty frame, which would then be baked into
 * the output as transparent or black edges the owner never chose.
 */
export function coverScale(image: Size, frame: Size): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  return Math.max(frame.width / image.width, frame.height / image.height);
}

/** How far the image may travel before an edge would enter the frame. */
export function offsetBounds(image: Size, frame: Size, scale: number): Offset {
  return {
    x: Math.max(0, (image.width * scale - frame.width) / 2),
    y: Math.max(0, (image.height * scale - frame.height) / 2),
  };
}

/** Keeps the frame inside the image, whatever the pointer just did. */
export function clampOffset(
  offset: Offset,
  image: Size,
  frame: Size,
  scale: number,
): Offset {
  const bounds = offsetBounds(image, frame, scale);
  return {
    x: zeroed(Math.min(bounds.x, Math.max(-bounds.x, offset.x))),
    y: zeroed(Math.min(bounds.y, Math.max(-bounds.y, offset.y))),
  };
}

/**
 * The region of the source image the frame is currently showing, in the
 * image's own pixels — the four numbers `drawImage` wants.
 */
export function sourceRect(
  image: Size,
  frame: Size,
  scale: number,
  offset: Offset,
): SourceRect {
  const sWidth = Math.min(image.width, frame.width / scale);
  const sHeight = Math.min(image.height, frame.height / scale);

  const { x, y } = clampOffset(offset, image, frame, scale);

  // Rounding can otherwise put an edge a fraction of a pixel outside the
  // bitmap, which draws as a transparent seam rather than as an error.
  return {
    sx: clamp((image.width - sWidth) / 2 - x / scale, 0, image.width - sWidth),
    sy: clamp((image.height - sHeight) / 2 - y / scale, 0, image.height - sHeight),
    sWidth,
    sHeight,
  };
}

/**
 * Output pixels for a crop: the source region, capped at `maxWidth`.
 *
 * Never upscales. Enlarging a small crop to hit the cap would produce a bigger
 * file carrying no more detail, which is the opposite of the point.
 */
export function outputSize(source: SourceRect, maxWidth: number): Size {
  const width = Math.max(1, Math.min(Math.round(source.sWidth), maxWidth));
  const height = Math.max(
    1,
    Math.round((width * source.sHeight) / source.sWidth),
  );
  return { width, height };
}

/** The largest box of this aspect that fits the space the panel gave us. */
export function frameBox(aspect: number, available: Size): Size {
  const width = Math.min(available.width, available.height * aspect);
  return { width, height: width / aspect };
}

/**
 * Whether this file should go through the cropper at all.
 *
 * A GIF is drawn to canvas one frame at a time, so cropping one silently
 * throws away the animation — the single reason the background ceiling is
 * 10MB. Animated files are uploaded as they are (R12).
 */
export function shouldCrop(type: string): boolean {
  return type !== "image/gif";
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Clamping against a zero bound yields -0, which renders as "-0px". */
function zeroed(value: number): number {
  return value === 0 ? 0 : value;
}
