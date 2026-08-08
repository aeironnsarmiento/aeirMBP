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
  type SiteSettings,
} from "./schema";

export * from "./schema";

export type SiteDb = PgDatabase<PgQueryResultHKT, typeof schema>;

const KEY_TO_FIELD = Object.fromEntries(
  Object.entries(SETTING_KEYS).map(([field, key]) => [
    key,
    field as keyof SiteSettings,
  ]),
) as Record<string, keyof SiteSettings>;

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
      case "avatarPath":
      case "backgroundPath":
      case "backgroundLightPath":
      case "backgroundDarkPath":
        settings[field] = typeof row.value === "string" ? row.value : null;
        break;
      case "backgroundId":
        if (isBackgroundId(row.value)) settings.backgroundId = row.value;
        break;
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
    }
  }

  return settings;
}

export async function readSiteSettings(
  db: SiteDb = getDb(),
): Promise<SiteSettings> {
  const rows = await db
    .select({ key: siteSetting.key, value: siteSetting.value })
    .from(siteSetting)
    .where(inArray(siteSetting.key, Object.values(SETTING_KEYS)));

  return rowsToSettings(rows);
}

export async function writeSiteSettings(
  patch: Partial<SiteSettings>,
  db: SiteDb = getDb(),
): Promise<SiteSettings> {
  validatePatch(patch);

  const entries = Object.entries(patch).filter(
    ([field, value]) => value !== undefined && field in SETTING_KEYS,
  ) as Array<[keyof SiteSettings, unknown]>;

  if (entries.length === 0) return readSiteSettings(db);

  const cleared = entries
    .filter(([, value]) => value === null)
    .map(([field]) => SETTING_KEYS[field]);
  const written = entries.filter(([, value]) => value !== null);

  const now = new Date();
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
