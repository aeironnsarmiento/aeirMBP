import { inArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { siteSetting } from "@/lib/db/schema";
import { isBackgroundId } from "@/lib/theme/backgrounds";
import {
  DEFAULT_SITE_SETTINGS,
  SETTING_KEYS,
  isSwitchoverTime,
  validatePatch,
  type SiteLink,
  type SiteSettings,
} from "./schema";

/**
 * The site query layer.
 *
 * Reads and writes `site_*` and nothing else (R15). Both the About widget and
 * the Settings widget go through here; neither touches `music_*`.
 *
 * Everything lives in one key/value table because these are a handful of
 * singleton values, not entities — a column per setting would mean a migration
 * every time the owner wants one more link in their bio.
 *
 * Shape, defaults and validation live in `./schema`, which carries no database
 * import so client components can use them.
 */

export * from "./schema";

/** Accepts any Drizzle Postgres client, so tests can pass an in-process one. */
export type SiteDb = PgDatabase<PgQueryResultHKT, typeof schema>;

const KEY_TO_FIELD = Object.fromEntries(
  Object.entries(SETTING_KEYS).map(([field, key]) => [
    key,
    field as keyof SiteSettings,
  ]),
) as Record<string, keyof SiteSettings>;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asLinks(value: unknown): SiteLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is SiteLink =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as SiteLink).label === "string" &&
        typeof (entry as SiteLink).href === "string",
    )
    .map((entry) => ({ label: entry.label, href: entry.href }));
}

function rowsToSettings(
  rows: readonly { key: string; value: unknown }[],
): SiteSettings {
  const settings: SiteSettings = { ...DEFAULT_SITE_SETTINGS };

  for (const row of rows) {
    const field = KEY_TO_FIELD[row.key];
    if (!field) continue;

    switch (field) {
      case "frameOpacity":
      case "paneOpacity": {
        const value = Number(row.value);
        if (Number.isFinite(value)) settings[field] = value;
        break;
      }
      case "links":
        settings.links = asLinks(row.value);
        break;
      case "avatarPath":
      case "backgroundPath":
      case "backgroundLightPath":
      case "backgroundDarkPath":
        settings[field] = typeof row.value === "string" ? row.value : null;
        break;
      case "backgroundId":
        if (isBackgroundId(row.value)) settings.backgroundId = row.value;
        break;
      // Each needs its own case: the default branch coerces through
      // `asString`, so anything reaching it reads back as "" with no error.
      case "backgroundLightId":
      case "backgroundDarkId":
        settings[field] = isBackgroundId(row.value) ? row.value : null;
        break;
      case "themeSwitchoverAt":
        settings.themeSwitchoverAt = isSwitchoverTime(row.value)
          ? row.value
          : null;
        break;
      case "themeSwitchoverTo":
        if (row.value === "light" || row.value === "dark") {
          settings.themeSwitchoverTo = row.value;
        }
        break;
      default:
        settings[field] = asString(row.value);
    }
  }

  return settings;
}

/** Full settings, with defaults filling any key the owner has never set. */
export async function readSiteSettings(
  db: SiteDb = getDb(),
): Promise<SiteSettings> {
  const rows = await db
    .select({ key: siteSetting.key, value: siteSetting.value })
    .from(siteSetting)
    .where(inArray(siteSetting.key, Object.values(SETTING_KEYS)));

  return rowsToSettings(rows);
}

/** Writes a validated patch and returns the settings as they now stand. */
export async function writeSiteSettings(
  patch: Partial<SiteSettings>,
  db: SiteDb = getDb(),
): Promise<SiteSettings> {
  validatePatch(patch);

  const entries = Object.entries(patch).filter(
    ([field, value]) => value !== undefined && field in SETTING_KEYS,
  ) as Array<[keyof SiteSettings, unknown]>;

  if (entries.length === 0) return readSiteSettings(db);

  /*
   * `null` clears a setting, and clearing means removing the row.
   *
   * `value` is `jsonb NOT NULL`, so null is not a value this table can hold —
   * writing one fails the insert outright. Absence is the representation the
   * schema already has for "unset", and the reader is built for it: a missing
   * key falls through to the defaults. Storing a JSON `null` instead would put
   * a second spelling of "unset" in the table for no gain.
   */
  const cleared = entries
    .filter(([, value]) => value === null)
    .map(([field]) => SETTING_KEYS[field]);
  const written = entries.filter(([, value]) => value !== null);

  const now = new Date();

  // One statement, not one per key. A loop of separate upserts is not just N
  // round trips — it has no atomicity, so a connection dropped halfway through
  // a Settings save leaves the site with some of the owner's changes applied
  // and the rest silently lost. A single multi-row upsert either lands whole
  // or not at all.
  await db.transaction(async (tx) => {
    if (cleared.length > 0) {
      await tx.delete(siteSetting).where(inArray(siteSetting.key, cleared));
    }

    if (written.length > 0) {
      await tx
        .insert(siteSetting)
        .values(
          written.map(([field, value]) => ({
            key: SETTING_KEYS[field],
            value: value as never,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: siteSetting.key,
          set: {
            value: sql`excluded.value`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
  });

  return readSiteSettings(db);
}
