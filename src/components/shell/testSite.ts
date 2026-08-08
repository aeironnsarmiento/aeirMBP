import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site/schema";
import type { BackgroundSlots } from "@/lib/theme/backgrounds";
import type { SiteContextValue } from "./SiteContext";

export function siteFixture(
  overrides: Partial<SiteContextValue> = {},
): SiteContextValue {
  return {
    settings: DEFAULT_SITE_SETTINGS,
    avatarUrl: null,
    backgrounds: backgroundsFixture(),
    isOwner: false,
    ...overrides,
  };
}

export function backgroundsFixture(
  settings: SiteSettings = DEFAULT_SITE_SETTINGS,
  urls: Partial<Record<"single" | "light" | "dark", string | null>> = {},
): BackgroundSlots {
  return {
    single: { id: settings.backgroundId, customUrl: urls.single ?? null },
    light: { id: settings.backgroundLightId, customUrl: urls.light ?? null },
    dark: { id: settings.backgroundDarkId, customUrl: urls.dark ?? null },
  };
}
