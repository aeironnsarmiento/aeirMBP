/**
 * Re-encodes an animated image to a compact looping video, in the browser.
 *
 * An animated GIF is the worst format a wallpaper can be here. It stores every
 * frame as a full palettised bitmap, so a few seconds of motion runs to tens of
 * megabytes; the decoder then repaints the whole viewport on every frame, and
 * because the frame above it carries a backdrop filter, each of those repaints
 * forces the blur to re-sample the entire screen. The site shipped a 10.2MB GIF
 * that way — 98% of its payload, and a permanent composite loop underneath the
 * one blurred layer the design budgets for.
 *
 * Video fixes both halves: inter-frame compression takes the bytes down by more
 * than an order of magnitude, and the decode runs on the platform's video path
 * instead of repainting a bitmap through the compositor.
 *
 * It happens client-side because the bytes never reach the application server —
 * a background is signed here and uploaded straight to storage to stay clear of
 * the hosting platform's 4.5MB body limit (R12, R13). There is no server in the
 * path to do this work.
 *
 * Every failure returns the original file. A wallpaper that uploads large beats
 * one that does not upload.
 */

import { baseMimeType } from "@/lib/site/schema";

/** Behind a blurred frame, detail past this is invisible; it only costs bitrate. */
const MAX_EDGE = 960;
/** Bounds both the encode wait and the output size. Wallpapers loop; they do not narrate. */
const MAX_DURATION_MS = 12_000;
const BITS_PER_SECOND = 900_000;

/**
 * Preferred first: MP4/H.264 plays everywhere, including the iOS Safari this
 * site is read on. WebM is the fallback for engines that record it but not MP4.
 */
const CANDIDATE_TYPES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

type DecodedFrame = { bitmap: ImageBitmap; durationMs: number };

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    "ImageDecoder" in window &&
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
}

function pickMimeType(): string | null {
  return CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/**
 * Decodes up to `MAX_DURATION_MS` of animation.
 *
 * Frames are read one at a time rather than all at once: a long GIF at full
 * resolution would otherwise hold every frame as an uncompressed bitmap and
 * exhaust memory on a phone before the encode ever starts.
 */
async function decodeFrames(file: File): Promise<DecodedFrame[]> {
  const Decoder = (window as unknown as { ImageDecoder: typeof ImageDecoder }).ImageDecoder;
  const decoder = new Decoder({ data: await file.arrayBuffer(), type: file.type });
  // Both, and in this order. `completed` only says the bytes arrived; the track
  // list is populated separately, and reading `selectedTrack` before `ready`
  // resolves returns null even for a perfectly good animation.
  await decoder.tracks.ready;
  await decoder.completed;

  const track = decoder.tracks.selectedTrack;
  if (!track || track.frameCount <= 1) return []; // a still image needs no video

  const frames: DecodedFrame[] = [];
  let total = 0;

  for (let index = 0; index < track.frameCount && total < MAX_DURATION_MS; index++) {
    const { image } = await decoder.decode({ frameIndex: index });
    // `duration` is microseconds and may be absent; 100ms is the GIF default.
    const durationMs = image.duration ? image.duration / 1000 : 100;
    frames.push({ bitmap: await createImageBitmap(image), durationMs });
    total += durationMs;
    image.close();
  }

  decoder.close();
  return frames;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Plays the decoded frames once into a MediaRecorder, in real time.
 *
 * Real time is not an oversight. A MediaRecorder timestamps what it captures by
 * the wall clock, so pushing frames faster than their own durations would
 * encode a video that plays back too fast.
 */
async function encode(frames: DecodedFrame[], mimeType: string): Promise<Blob> {
  const source = frames[0].bitmap;
  const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const context = canvas.getContext("2d")!;

  const stream = canvas.captureStream();
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: BITS_PER_SECOND,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  recorder.start();
  for (const frame of frames) {
    context.drawImage(frame.bitmap, 0, 0, canvas.width, canvas.height);
    await wait(frame.durationMs);
  }
  recorder.stop();
  stream.getTracks().forEach((track) => track.stop());

  return finished;
}

/**
 * @returns a video File when re-encoding produced a smaller one, else `original`.
 */
export async function transcodeAnimation(original: File): Promise<File> {
  if (!original.type.startsWith("image/") || !supported()) return original;

  const mimeType = pickMimeType();
  if (!mimeType) return original;

  let frames: DecodedFrame[] = [];
  try {
    frames = await decodeFrames(original);
    if (frames.length < 2) return original;

    const blob = await encode(frames, mimeType);

    // A short, already-efficient animation can encode larger than it started.
    // Keeping whichever is smaller means this can only ever help.
    if (blob.size >= original.size) return original;

    // Stored without the codec parameter. `MediaRecorder` reports the exact
    // encoding it used (`video/webm;codecs=vp8`), which is more than storage
    // or the validator want to know, and more than any of them match on.
    const base = baseMimeType(mimeType);
    const extension = base === "video/mp4" ? "mp4" : "webm";
    const stem = original.name.replace(/\.[^.]+$/, "") || "background";
    return new File([blob], `${stem}.${extension}`, { type: base });
  } catch {
    // Unsupported codec path, decoder rejection, or a frame that would not
    // decode — the original still uploads.
    return original;
  } finally {
    frames.forEach((frame) => frame.bitmap.close());
  }
}
