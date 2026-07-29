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
export function backgroundKind(url: string): "image" | "video" {
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
 * The preset an unset slot falls back to (R8), and the first consumer of
 * `mood`. The global default is dark-mood, so falling back to it would hand a
 * light slot a dark image — the complaint the pair exists to answer. Four dark
 * presets, one light, so the light fallback has exactly one candidate.
 */
export function presetForMood(mood: "light" | "dark"): Background {
  return (
    BACKGROUNDS.find((background) => background.mood === mood) ??
    defaultBackground()
  );
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
          kind: backgroundKind(customUrl),
        }
      : defaultBackground();
  }

  return (
    BACKGROUNDS.find((background) => background.id === id) ?? defaultBackground()
  );
}

/** Uploads already resolved to URLs: that needs the storage module, and this
 *  one is imported by client components. */
export type BackgroundSlots = {
  /** The single background. Covers whichever per-mode slots are unset. */
  single: { id: string; customUrl: string | null };
  light: { id: string | null; customUrl: string | null };
  dark: { id: string | null; customUrl: string | null };
};

/** Whether the owner has attached per-mode backgrounds at all. */
export function hasBackgroundPair(slots: BackgroundSlots): boolean {
  return slots.light.id !== null || slots.dark.id !== null;
}

/**
 * The background for a resolved appearance (R8), in three states:
 *
 *   1. Slot set — use it.
 *   2. Neither slot set — the single background covers both, so switching
 *      changes no wallpaper (AE2). Also what a pre-pair owner has.
 *   3. This slot unset, the other set — the owner emptied half a pair, so a
 *      mood-matched preset fills the gap rather than the dark default (AE3).
 */
export function backgroundForAppearance(
  appearance: "light" | "dark",
  slots: BackgroundSlots,
): Background {
  const slot = slots[appearance];
  if (slot.id !== null) return backgroundById(slot.id, slot.customUrl);

  if (!hasBackgroundPair(slots)) {
    return backgroundById(slots.single.id, slots.single.customUrl);
  }

  return presetForMood(appearance);
}
