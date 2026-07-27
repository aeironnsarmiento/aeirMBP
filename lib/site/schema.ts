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
  /** The frame's translucency — the one surface that blurs (R14). */
  frameOpacity: number;
  /** Everything nested inside the frame (R14). */
  paneOpacity: number;
  avatarPath: string | null;
  /** Object path of the owner's uploaded background, when there is one (R11). */
  backgroundPath: string | null;
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

/** The opacity dials, so validation and the picker iterate one list. */
export const OPACITY_FIELDS = ["frameOpacity", "paneOpacity"] as const;

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  backgroundId: DEFAULT_BACKGROUND_ID,
  frameOpacity: 0.55,
  paneOpacity: 0.55,
  avatarPath: null,
  backgroundPath: null,
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
  // Key kept from when there was one dial, so an owner who already set a
  // value keeps it. The field was renamed; the key is the durable contract.
  frameOpacity: "theme.glassOpacity",
  paneOpacity: "theme.paneOpacity",
  avatarPath: "site.avatarPath",
  backgroundPath: "site.backgroundPath",
  aboutCopy: "about.copy",
  name: "about.name",
  handle: "about.handle",
  location: "about.location",
  links: "about.links",
} as const satisfies Record<keyof SiteSettings, string>;

/* --- Uploadable assets ----------------------------------------------------
 *
 * Rules live here rather than beside the upload code because the Settings
 * panel is a client component and has to show the ceiling it will actually be
 * held to (R16). `lib/site/storage.ts` imports the storage SDK, so importing a
 * constant from there would pull that SDK into the browser bundle.
 */

export type AssetKind = "avatar" | "background";

const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;

/**
 * Backgrounds only. An animated upload is re-encoded to one of these in the
 * browser before it is sent (`lib/media/transcodeAnimation.ts`), so these are
 * what the settings panel usually ends up storing rather than an exotic choice
 * the owner has to make.
 */
const VIDEO_TYPES = ["video/mp4", "video/webm"] as const;

export const ASSET_RULES = {
  // Relayed through the application server, so it stays clear of the hosting
  // platform's 4.5MB request-body limit (R17).
  avatar: { prefix: "avatar", maxBytes: 3 * 1024 * 1024, types: IMAGE_TYPES },
  // Sent straight to storage, so the platform limit does not apply (R12, R13).
  background: {
    prefix: "background",
    maxBytes: 10 * 1024 * 1024,
    types: [...IMAGE_TYPES, ...VIDEO_TYPES],
  },
} as const satisfies Record<
  AssetKind,
  { prefix: string; maxBytes: number; types: readonly string[] }
>;

/**
 * Every type any kind accepts, and the largest ceiling any kind allows.
 *
 * The bucket has to be configured for the most permissive kind, since one
 * bucket holds both. Derived rather than restated so raising a ceiling here
 * cannot leave the bucket configured for the old one.
 */
export const ACCEPTED_ASSET_TYPES: readonly string[] = [
  ...new Set(Object.values(ASSET_RULES).flatMap((rules) => [...rules.types])),
];

export const MAX_ASSET_BYTES: number = Math.max(
  ...Object.values(ASSET_RULES).map((rules) => rules.maxBytes),
);

/** Renders a byte count the way the owner-facing copy states it. */
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

/**
 * Rejects anything that is not an image within the kind's ceiling.
 *
 * An over-large upload is refused outright rather than truncated — a truncated
 * image is a corrupt file that renders as a broken asset with no error
 * anywhere to explain it.
 */
export function validateAsset(
  kind: AssetKind,
  file: { type: string; size: number },
): void {
  const rules = ASSET_RULES[kind];

  if (!(rules.types as readonly string[]).includes(file.type)) {
    throw new UploadRejected(
      `Unsupported file type: ${file.type || "unknown"}. Upload a PNG, JPEG, WebP, AVIF or GIF.`,
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
