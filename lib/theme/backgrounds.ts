export type Background = {
  id: string;
  label: string;
  src: string;
  /** Which appearance the image reads best in, for the picker's ordering. */
  mood: "dark" | "light";
  /** A video needs an element, not a background-image. Presets are all stills. */
  kind: "image" | "video";
};

/** The stored path is the only signal; storage does not hand back a MIME type. */
function kindFor(url: string): "image" | "video" {
  return /\.(mp4|webm)(\?|$)/i.test(url) ? "video" : "image";
}

/**
 * The committed background set (R8).
 *
 * Static images rather than video: compositing a decoding video and then
 * blurring it several times a frame is the most likely source of jank on a
 * phone, and R7 commits the layout to working there.
 *
 * They are SVG gradient meshes, so they scale to any viewport with no decode
 * cost and no licensing question. Dropping a photograph into
 * `public/backgrounds/` and adding a line here is all it takes to extend the
 * set — the picker and the validator both read from this list.
 */
export const BACKGROUNDS: readonly Background[] = [
  { id: "aurora", label: "Aurora", src: "/backgrounds/aurora.svg", mood: "dark", kind: "image" },
  { id: "orchid", label: "Orchid", src: "/backgrounds/orchid.svg", mood: "dark", kind: "image" },
  { id: "dune", label: "Dune", src: "/backgrounds/dune.svg", mood: "dark", kind: "image" },
  { id: "graphite", label: "Graphite", src: "/backgrounds/graphite.svg", mood: "dark", kind: "image" },
  { id: "frost", label: "Frost", src: "/backgrounds/frost.svg", mood: "light", kind: "image" },
];

export const DEFAULT_BACKGROUND_ID = "aurora";

/**
 * The owner's own image (R11).
 *
 * Modelled as one more entry in the list rather than a separate mode, so the
 * picker keeps iterating one collection, the validator keeps rejecting
 * anything outside it, and the shell keeps resolving one id to one source.
 */
export const CUSTOM_BACKGROUND_ID = "custom";

function isPresetBackgroundId(value: unknown): value is string {
  return BACKGROUNDS.some((background) => background.id === value);
}

export function isBackgroundId(value: unknown): value is string {
  return value === CUSTOM_BACKGROUND_ID || isPresetBackgroundId(value);
}

function defaultBackground(): Background {
  return BACKGROUNDS.find(
    (background) => background.id === DEFAULT_BACKGROUND_ID,
  )!;
}

/**
 * Resolves the selected id to something renderable.
 *
 * `customUrl` is passed in rather than derived, because resolving a stored
 * object path needs the storage module and this one is imported by client
 * components. Selecting the custom background without an uploaded image falls
 * back to the default rather than stranding the site on a missing file.
 */
export function backgroundById(
  id: string,
  customUrl: string | null = null,
): Background {
  if (id === CUSTOM_BACKGROUND_ID) {
    return customUrl
      ? {
          id: CUSTOM_BACKGROUND_ID,
          label: "Yours",
          src: customUrl,
          mood: "dark",
          kind: kindFor(customUrl),
        }
      : defaultBackground();
  }

  return (
    BACKGROUNDS.find((background) => background.id === id) ?? defaultBackground()
  );
}
