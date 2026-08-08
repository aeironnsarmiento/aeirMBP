import { Shell } from "@/components/shell/Shell/Shell";
import { ThemeVars } from "@/components/shell/ThemeVars";
import { isOwnerRequest } from "@/lib/auth/guard";
import {
  DEFAULT_SITE_SETTINGS,
  readSiteSettings,
  type SiteSettings,
} from "@/lib/site/settings";
import { publicAssetUrl } from "@/lib/site/storage";
import type { BackgroundSlots } from "@/lib/theme/backgrounds";
import { readNowPlaying } from "@/widgets/music/server/now";
import type { NowPlaying } from "@/widgets/music/server/now";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [settings, isOwner, nowPlaying] = await Promise.all([
    safeSettings(),
    safeOwner(),
    safeNowPlaying(),
  ]);

  const backgrounds: BackgroundSlots = {
    single: {
      id: settings.backgroundId,
      customUrl: publicAssetUrl(settings.backgroundPath),
    },
    light: {
      id: settings.backgroundLightId,
      customUrl: publicAssetUrl(settings.backgroundLightPath),
    },
    dark: {
      id: settings.backgroundDarkId,
      customUrl: publicAssetUrl(settings.backgroundDarkPath),
    },
  };

  return (
    <>
      <ThemeVars settings={settings} backgrounds={backgrounds} />
      <Shell
        site={{
          settings,
          avatarUrl: publicAssetUrl(settings.avatarPath),
          backgrounds,
          isOwner,
        }}
        nowPlaying={nowPlaying}
      />
    </>
  );
}

function reportDegraded(what: string, error: unknown): void {
  console.error(
    `[page] ${what} failed; rendering the degraded path:`,
    error instanceof Error ? error.message : error,
  );
}

async function safeSettings(): Promise<SiteSettings> {
  try {
    return await readSiteSettings();
  } catch (error) {
    reportDegraded("settings read", error);
    return DEFAULT_SITE_SETTINGS;
  }
}

async function safeOwner(): Promise<boolean> {
  try {
    return await isOwnerRequest();
  } catch (error) {
    reportDegraded("owner check", error);
    return false;
  }
}

async function safeNowPlaying(): Promise<NowPlaying | null> {
  try {
    return await readNowPlaying();
  } catch (error) {
    reportDegraded("now-playing read", error);
    return null;
  }
}
