"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { GlassSurface } from "@/components/glass/GlassSurface";
import styles from "./ImageCropper.module.css";
import {
  clampOffset,
  coverScale,
  outputSize,
  sourceRect,
  type Offset,
  type Size,
} from "../cropGeometry";

const OUTPUT_TYPE = "image/webp";
const OUTPUT_QUALITY = 0.92;
const MAX_ZOOM = 4;
const KEY_STEP = 12;

export type ImageCropperProps = {
  file: File;
  aspect: number;
  maxWidth: number;
  label: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onCommit: (file: File) => void;
};

export function ImageCropper({
  file,
  aspect,
  maxWidth,
  label,
  confirmLabel,
  busy = false,
  onCancel,
  onCommit,
}: ImageCropperProps) {
  const [source, setSource] = useState<(Size & { url: string }) | null>(null);
  const [frame, setFrame] = useState<Size>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragged, setDragged] = useState<Offset>({ x: 0, y: 0 });
  const [failed, setFailed] = useState<string | null>(null);

  const elementRef = useRef<HTMLImageElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Offset | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);

    const element = new Image();
    element.onload = () => {
      elementRef.current = element;
      setSource({
        url: objectUrl,
        width: element.naturalWidth,
        height: element.naturalHeight,
      });
    };
    element.onerror = () => setFailed("That file could not be read as an image.");
    element.src = objectUrl;

    return () => {
      element.onload = null;
      element.onerror = null;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;

    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setFrame({ width: box.width, height: box.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const scale = source ? coverScale(source, frame) * zoom : 1;
  const offset = source ? clampOffset(dragged, source, frame, scale) : dragged;

  const move = useCallback(
    (dx: number, dy: number) => {
      if (!source) return;
      setDragged((current) =>
        clampOffset(
          { x: current.x + dx, y: current.y + dy },
          source,
          frame,
          scale,
        ),
      );
    },
    [source, frame, scale],
  );

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (busy) return;
    dragRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragRef.current;
    if (!start) return;
    dragRef.current = { x: event.clientX, y: event.clientY };
    move(event.clientX - start.x, event.clientY - start.y);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [KEY_STEP, 0],
      ArrowRight: [-KEY_STEP, 0],
      ArrowUp: [0, KEY_STEP],
      ArrowDown: [0, -KEY_STEP],
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    move(step[0], step[1]);
  }

  function commit() {
    const element = elementRef.current;
    if (!element || !source || frame.width === 0) return;

    const region = sourceRect(source, frame, scale, offset);
    const output = outputSize(region, maxWidth);

    const canvas = document.createElement("canvas");
    canvas.width = output.width;
    canvas.height = output.height;

    const context = canvas.getContext("2d");
    if (!context) {
      setFailed("This browser could not render the crop.");
      return;
    }

    context.imageSmoothingQuality = "high";
    context.drawImage(
      element,
      region.sx,
      region.sy,
      region.sWidth,
      region.sHeight,
      0,
      0,
      output.width,
      output.height,
    );

    const deliver = (blob: Blob | null) => {
      if (!blob) {
        setFailed("This browser could not encode the crop.");
        return;
      }
      const type = blob.type || "image/png";
      const extension = type === OUTPUT_TYPE ? "webp" : "png";
      onCommit(new File([blob], `${label}.${extension}`, { type }));
    };

    canvas.toBlob(
      (blob) =>
        blob ? deliver(blob) : canvas.toBlob(deliver, "image/png"),
      OUTPUT_TYPE,
      OUTPUT_QUALITY,
    );
  }

  return (
    <GlassSurface tone="well" className={styles.cropper}>
      <div
        ref={frameRef}
        className={styles.frame}
        style={{ "--crop-aspect": String(aspect) } as CSSProperties}
        role="group"
        aria-label={`Position the ${label}. Drag, or use the arrow keys.`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {source ? (
          <img
            className={styles.image}
            src={source.url}
            alt=""
            draggable={false}
            style={{
              width: `${source.width * scale}px`,
              height: `${source.height * scale}px`,
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
            }}
          />
        ) : null}
        <div className={styles.grid} aria-hidden="true" />
      </div>

      <div className={styles.controls}>
        <label className={styles.zoom}>
          <span className={styles.zoomLabel}>Zoom</span>
          <input
            className={styles.slider}
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            disabled={busy || !source}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.button}
            data-primary="true"
            disabled={busy || !source}
            onClick={commit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>

      {failed ? <p className={styles.failure}>{failed}</p> : null}
    </GlassSurface>
  );
}
