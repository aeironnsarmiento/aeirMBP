import { SiteProvider } from "@/components/shell/SiteContext";
import { backgroundsFixture, siteFixture } from "@/components/shell/testSite";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site/schema";
import { SettingsExpanded } from "./expanded/expanded";

type BackgroundUrls = Partial<
  Record<"single" | "light" | "dark", string | null>
>;

export function settingsPanel(
  overrides: Partial<SiteSettings> = {},
  urls: BackgroundUrls = {},
) {
  const settings = { ...DEFAULT_SITE_SETTINGS, ...overrides };
  return (
    <SiteProvider
      value={siteFixture({
        settings,
        backgrounds: backgroundsFixture(settings, urls),
        isOwner: true,
      })}
    >
      <SettingsExpanded />
    </SiteProvider>
  );
}
