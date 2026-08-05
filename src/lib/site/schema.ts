import { DEFAULT_BACKGROUND_ID, isBackgroundId } from "@/lib/theme/backgrounds";

export type Appearance = "light" | "dark";

export const APPEARANCES = ["light", "dark"] as const;

export type SiteSettings = {
  backgroundId: string;
  frameOpacity: number;
  paneOpacity: number;
  avatarPath: string | null;
  backgroundPath: string | null;
  backgroundLightId: string | null;
  backgroundDarkId: string | null;
  backgroundLightPath: string | null;
  backgroundDarkPath: string | null;
  themeSwitchoverAt: string | null;
  themeSwitchoverTo: Appearance;
};

export const GLASS_OPACITY_MIN = 0.2;
export const GLASS_OPACITY_MAX = 0.85;

export const OPACITY_FIELDS = ["frameOpacity", "paneOpacity"] as const;

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  backgroundId: DEFAULT_BACKGROUND_ID,
  frameOpacity: 0.55,
  paneOpacity: 0.55,
  avatarPath: null,
  backgroundPath: null,
  backgroundLightId: null,
  backgroundDarkId: null,
  backgroundLightPath: null,
  backgroundDarkPath: null,
  themeSwitchoverAt: null,
  themeSwitchoverTo: "dark",
};

export const SETTING_KEYS = {
  backgroundId: "theme.background",
  frameOpacity: "theme.glassOpacity",
  paneOpacity: "theme.paneOpacity",
  avatarPath: "site.avatarPath",
  backgroundPath: "site.backgroundPath",
  backgroundLightId: "theme.backgroundLight",
  backgroundDarkId: "theme.backgroundDark",
  backgroundLightPath: "site.backgroundLightPath",
  backgroundDarkPath: "site.backgroundDarkPath",
  themeSwitchoverAt: "theme.switchoverAt",
  themeSwitchoverTo: "theme.switchoverTo",
} as const satisfies Record<keyof SiteSettings, string>;

export type AssetKind = "avatar" | "background";

const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;

const VIDEO_TYPES = ["video/mp4", "video/webm"] as const;

export const ASSET_RULES = {
  avatar: { prefix: "avatar", maxBytes: 3 * 1024 * 1024, types: IMAGE_TYPES },
  background: {
    prefix: "background",
    maxBytes: 10 * 1024 * 1024,
    types: [...IMAGE_TYPES, ...VIDEO_TYPES],
  },
} as const satisfies Record<
  AssetKind,
  { prefix: string; maxBytes: number; types: readonly string[] }
>;

export const ACCEPTED_ASSET_TYPES: readonly string[] = [
  ...new Set(Object.values(ASSET_RULES).flatMap((rules) => [...rules.types])),
];

export const MAX_ASSET_BYTES: number = Math.max(
  ...Object.values(ASSET_RULES).map((rules) => rules.maxBytes),
);

export function formatMegabytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`;
}

export class UploadRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejected";
  }
}

export function baseMimeType(type: string): string {
  return type.split(";")[0].trim().toLowerCase();
}

export function validateAsset(
  kind: AssetKind,
  file: { type: string; size: number },
): void {
  const rules = ASSET_RULES[kind];

  if (!(rules.types as readonly string[]).includes(baseMimeType(file.type))) {
    const accepted = rules.types
      .map((type) => baseMimeType(type).split("/")[1].toUpperCase())
      .join(", ");
    throw new UploadRejected(
      `Unsupported file type: ${file.type || "unknown"}. Accepted here: ${accepted}.`,
    );
  }
  if (file.size <= 0) {
    throw new UploadRejected("File is empty.");
  }
  if (file.size > rules.maxBytes) {
    throw new UploadRejected(
      `File is ${formatMegabytes(file.size)}; the limit is ${formatMegabytes(rules.maxBytes)}.`,
    );
  }
}

export class SettingsValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "SettingsValidationError";
    this.field = field;
  }
}

export const BACKGROUND_SLOT_FIELDS = {
  light: "backgroundLightId",
  dark: "backgroundDarkId",
} as const satisfies Record<Appearance, keyof SiteSettings>;

export const BACKGROUND_SLOT_PATH_FIELDS = {
  light: "backgroundLightPath",
  dark: "backgroundDarkPath",
} as const satisfies Record<Appearance, keyof SiteSettings>;

/** `HH:MM` on a 24-hour clock, and nothing else. */
const SWITCHOVER_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isSwitchoverTime(value: unknown): value is string {
  return typeof value === "string" && SWITCHOVER_PATTERN.test(value);
}

export function switchoverMinutes(value: string): number {
  const [hours, minutes] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function validatePatch(patch: Partial<SiteSettings>): void {
  if (patch.backgroundId !== undefined && !isBackgroundId(patch.backgroundId)) {
    throw new SettingsValidationError(
      "backgroundId",
      `Unknown background: ${String(patch.backgroundId)}`,
    );
  }

  for (const field of Object.values(BACKGROUND_SLOT_FIELDS)) {
    const value = patch[field];
    if (value === undefined || value === null) continue;
    if (!isBackgroundId(value)) {
      throw new SettingsValidationError(
        field,
        `Unknown background: ${String(value)}`,
      );
    }
  }

  for (const field of Object.values(BACKGROUND_SLOT_PATH_FIELDS)) {
    const value = patch[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      throw new SettingsValidationError(field, `${field} must be a stored path`);
    }
  }

  if (patch.themeSwitchoverAt !== undefined && patch.themeSwitchoverAt !== null) {
    if (!isSwitchoverTime(patch.themeSwitchoverAt)) {
      throw new SettingsValidationError(
        "themeSwitchoverAt",
        `Switchover time must be HH:MM between 00:00 and 23:59: ${String(patch.themeSwitchoverAt)}`,
      );
    }
  }

  if (
    patch.themeSwitchoverTo !== undefined &&
    !(APPEARANCES as readonly unknown[]).includes(patch.themeSwitchoverTo)
  ) {
    throw new SettingsValidationError(
      "themeSwitchoverTo",
      `Switchover appearance must be light or dark: ${String(patch.themeSwitchoverTo)}`,
    );
  }

  for (const field of OPACITY_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < GLASS_OPACITY_MIN ||
      value > GLASS_OPACITY_MAX
    ) {
      throw new SettingsValidationError(
        field,
        `${field === "frameOpacity" ? "Frame" : "Pane"} opacity must be between ${GLASS_OPACITY_MIN} and ${GLASS_OPACITY_MAX}`,
      );
    }
  }

}
