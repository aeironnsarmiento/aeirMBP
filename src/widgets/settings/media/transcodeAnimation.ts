import { baseMimeType } from "@/lib/site/schema";

const MAX_EDGE = 960;
const MAX_DURATION_MS = 12_000;
const BITS_PER_SECOND = 900_000;

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

async function decodeFrames(file: File): Promise<DecodedFrame[]> {
  const Decoder = (window as unknown as { ImageDecoder: typeof ImageDecoder }).ImageDecoder;
  const decoder = new Decoder({ data: await file.arrayBuffer(), type: file.type });
  await decoder.tracks.ready;
  await decoder.completed;

  const track = decoder.tracks.selectedTrack;
  if (!track || track.frameCount <= 1) return [];

  const frames: DecodedFrame[] = [];
  let total = 0;

  for (let index = 0; index < track.frameCount && total < MAX_DURATION_MS; index++) {
    const { image } = await decoder.decode({ frameIndex: index });
    const durationMs = image.duration ? image.duration / 1000 : 100;
    frames.push({ bitmap: await createImageBitmap(image), durationMs });
    total += durationMs;
    image.close();
  }

  decoder.close();
  return frames;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

export async function transcodeAnimation(original: File): Promise<File> {
  if (!original.type.startsWith("image/") || !supported()) return original;

  const mimeType = pickMimeType();
  if (!mimeType) return original;

  let frames: DecodedFrame[] = [];
  try {
    frames = await decodeFrames(original);
    if (frames.length < 2) return original;

    const blob = await encode(frames, mimeType);

    if (blob.size >= original.size) return original;

    const base = baseMimeType(mimeType);
    const extension = base === "video/mp4" ? "mp4" : "webm";
    const stem = original.name.replace(/\.[^.]+$/, "") || "background";
    return new File([blob], `${stem}.${extension}`, { type: base });
  } catch {
    return original;
  } finally {
    frames.forEach((frame) => frame.bitmap.close());
  }
}
