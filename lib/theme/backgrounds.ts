export type Background = {
  id: string;
  label: string;
  src: string;
  /** Which appearance the image reads best in, for the picker's ordering. */
  mood: "dark" | "light";
};

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
  { id: "aurora", label: "Aurora", src: "/backgrounds/aurora.svg", mood: "dark" },
  { id: "orchid", label: "Orchid", src: "/backgrounds/orchid.svg", mood: "dark" },
  { id: "dune", label: "Dune", src: "/backgrounds/dune.svg", mood: "dark" },
  { id: "graphite", label: "Graphite", src: "/backgrounds/graphite.svg", mood: "dark" },
  { id: "frost", label: "Frost", src: "/backgrounds/frost.svg", mood: "light" },
];

export const DEFAULT_BACKGROUND_ID = "aurora";

export function isBackgroundId(value: unknown): value is string {
  return BACKGROUNDS.some((background) => background.id === value);
}

export function backgroundById(id: string): Background {
  return (
    BACKGROUNDS.find((background) => background.id === id) ??
    BACKGROUNDS.find((background) => background.id === DEFAULT_BACKGROUND_ID)!
  );
}
