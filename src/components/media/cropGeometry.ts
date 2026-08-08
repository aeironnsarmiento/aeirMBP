export type Size = { width: number; height: number };
export type Offset = { x: number; y: number };
export type SourceRect = {
  sx: number;
  sy: number;
  sWidth: number;
  sHeight: number;
};

export function coverScale(image: Size, frame: Size): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  return Math.max(frame.width / image.width, frame.height / image.height);
}

export function offsetBounds(image: Size, frame: Size, scale: number): Offset {
  return {
    x: Math.max(0, (image.width * scale - frame.width) / 2),
    y: Math.max(0, (image.height * scale - frame.height) / 2),
  };
}

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

export function sourceRect(
  image: Size,
  frame: Size,
  scale: number,
  offset: Offset,
): SourceRect {
  const sWidth = Math.min(image.width, frame.width / scale);
  const sHeight = Math.min(image.height, frame.height / scale);

  const { x, y } = clampOffset(offset, image, frame, scale);

  return {
    sx: clamp((image.width - sWidth) / 2 - x / scale, 0, image.width - sWidth),
    sy: clamp((image.height - sHeight) / 2 - y / scale, 0, image.height - sHeight),
    sWidth,
    sHeight,
  };
}

export function outputSize(source: SourceRect, maxWidth: number): Size {
  const width = Math.max(1, Math.min(Math.round(source.sWidth), maxWidth));
  const height = Math.max(
    1,
    Math.round((width * source.sHeight) / source.sWidth),
  );
  return { width, height };
}

export function frameBox(aspect: number, available: Size): Size {
  const width = Math.min(available.width, available.height * aspect);
  return { width, height: width / aspect };
}

export function shouldCrop(type: string): boolean {
  return type !== "image/gif";
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function zeroed(value: number): number {
  return value === 0 ? 0 : value;
}
