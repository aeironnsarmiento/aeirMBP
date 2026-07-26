import { DEFAULT_BACKGROUND_ID, isBackgroundId } from "@/lib/theme/backgrounds";

/**
 * Site settings: shape, defaults and validation.
 *
 * Deliberately free of any database import. The Settings widget and the shell
 * are client components that need these constants, and a value import that
 * reaches `lib/db/client` would drag the Postgres driver into the browser
 * bundle. Reads and writes live in `settings.ts`.
 */

export type SiteLink = { label: string; href: string };

export type SiteSettings = {
  /** Owner-authored identity, served to every visitor (R8, R10). */
  backgroundId: string;
  glassOpacity: number;
  avatarPath: string | null;
  /** About content (R17, R19). */
  aboutCopy: string;
  name: string;
  handle: string;
  location: string;
  links: SiteLink[];
};

export const GLASS_OPACITY_MIN = 0.2;
export const GLASS_OPACITY_MAX = 0.85;
export const ABOUT_COPY_MAX_LENGTH = 4_000;

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  backgroundId: DEFAULT_BACKGROUND_ID,
  glassOpacity: 0.55,
  avatarPath: null,
  aboutCopy:
    "I build things for the web and listen to a lot of music. This site is a desktop: every tab is a widget you can open, and the music one runs on my own scrobble history rather than someone else's dashboard.",
  name: "xenavalon",
  handle: "xenavalon",
  location: "",
  links: [
    { label: "last.fm", href: "https://www.last.fm/user/xenavalon" },
    { label: "moonbites", href: "https://moonbites-blue.vercel.app" },
  ],
};

/** Storage keys. Stable — renaming one orphans the stored value. */
export const SETTING_KEYS = {
  backgroundId: "theme.background",
  glassOpacity: "theme.glassOpacity",
  avatarPath: "site.avatarPath",
  aboutCopy: "about.copy",
  name: "about.name",
  handle: "about.handle",
  location: "about.location",
  links: "about.links",
} as const satisfies Record<keyof SiteSettings, string>;

export class SettingsValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "SettingsValidationError";
    this.field = field;
  }
}

/**
 * Validates a patch before it is written.
 *
 * Out-of-range values are rejected rather than clamped: silently turning an
 * opacity of 4 into 0.85 hides a caller bug and leaves the owner wondering why
 * the slider did nothing.
 */
export function validatePatch(patch: Partial<SiteSettings>): void {
  if (patch.backgroundId !== undefined && !isBackgroundId(patch.backgroundId)) {
    throw new SettingsValidationError(
      "backgroundId",
      `Unknown background: ${String(patch.backgroundId)}`,
    );
  }

  if (patch.glassOpacity !== undefined) {
    const value = patch.glassOpacity;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < GLASS_OPACITY_MIN ||
      value > GLASS_OPACITY_MAX
    ) {
      throw new SettingsValidationError(
        "glassOpacity",
        `Glass opacity must be between ${GLASS_OPACITY_MIN} and ${GLASS_OPACITY_MAX}`,
      );
    }
  }

  if (patch.aboutCopy !== undefined) {
    if (typeof patch.aboutCopy !== "string") {
      throw new SettingsValidationError("aboutCopy", "About copy must be text");
    }
    if (patch.aboutCopy.length > ABOUT_COPY_MAX_LENGTH) {
      throw new SettingsValidationError(
        "aboutCopy",
        `About copy is limited to ${ABOUT_COPY_MAX_LENGTH} characters`,
      );
    }
  }

  for (const field of ["name", "handle", "location"] as const) {
    const value = patch[field];
    if (value !== undefined && typeof value !== "string") {
      throw new SettingsValidationError(field, `${field} must be text`);
    }
  }

  if (patch.links !== undefined) {
    if (!Array.isArray(patch.links)) {
      throw new SettingsValidationError("links", "Links must be a list");
    }
    for (const link of patch.links) {
      if (typeof link?.label !== "string" || typeof link?.href !== "string") {
        throw new SettingsValidationError(
          "links",
          "Each link needs a label and an href",
        );
      }
      // Only http(s). A javascript: href here would render as a live XSS
      // vector on a page every visitor loads.
      if (!/^https?:\/\//i.test(link.href)) {
        throw new SettingsValidationError(
          "links",
          `Link href must start with http:// or https://: ${link.href}`,
        );
      }
    }
  }
}
