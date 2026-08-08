export type Background = {
  id: string;
  label: string;
  src: string;
  mood: "dark" | "light";
  kind: "image" | "video";
};

export function backgroundKind(url: string): "image" | "video" {
  return /\.(mp4|webm)(\?|$)/i.test(url) ? "video" : "image";
}

export const BACKGROUNDS: readonly Background[] = [
  { id: "aurora", label: "Aurora", src: "/backgrounds/aurora.svg", mood: "dark", kind: "image" },
  { id: "orchid", label: "Orchid", src: "/backgrounds/orchid.svg", mood: "dark", kind: "image" },
  { id: "dune", label: "Dune", src: "/backgrounds/dune.svg", mood: "dark", kind: "image" },
  { id: "graphite", label: "Graphite", src: "/backgrounds/graphite.svg", mood: "dark", kind: "image" },
  { id: "frost", label: "Frost", src: "/backgrounds/frost.svg", mood: "light", kind: "image" },
];

export const DEFAULT_BACKGROUND_ID = "aurora";

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

export function presetForMood(mood: "light" | "dark"): Background {
  return (
    BACKGROUNDS.find((background) => background.mood === mood) ??
    defaultBackground()
  );
}

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

export type BackgroundSlots = {
  single: { id: string; customUrl: string | null };
  light: { id: string | null; customUrl: string | null };
  dark: { id: string | null; customUrl: string | null };
};

export function hasBackgroundPair(slots: BackgroundSlots): boolean {
  return slots.light.id !== null || slots.dark.id !== null;
}

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
