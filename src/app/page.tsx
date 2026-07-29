import { Shell } from "@/components/shell/Shell";
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

/**
 * The dashboard.
 *
 * Resolves owner-authored state and the owner session on the server, then
 * hands both to the client shell. Owner status is decided here so the registry
 * filter runs against a value the client cannot forge (R16).
 *
 * Both reads degrade rather than fail: an unconfigured or unreachable database
 * renders the site with defaults instead of an error page, and last.fm being
 * down costs the pulse and nothing else (AE8).
 */
export default async function Page() {
  const [settings, isOwner, nowPlaying] = await Promise.all([
    safeSettings(),
    safeOwner(),
    safeNowPlaying(),
  ]);

  // Resolved once here: turning a stored path into a URL needs the storage
  // module, and both consumers below are client-safe.
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

/**
 * Degrading, but no longer silently. A failed settings read renders the whole
 * site from defaults, which right after a save is indistinguishable from a
 * save that never took — the last standing candidate for the About-save
 * defect. See docs/about-save-propagation-diagnosis.md.
 */
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
    // A missing OWNER_SECRET means owner auth cannot operate. Failing closed
    // is the only safe reading of that.
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
