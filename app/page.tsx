import { Shell } from "@/components/shell/Shell";
import { ThemeVars } from "@/components/shell/ThemeVars";
import { isOwnerRequest } from "@/lib/auth/guard";
import {
  DEFAULT_SITE_SETTINGS,
  readSiteSettings,
  type SiteSettings,
} from "@/lib/site/settings";
import { publicAvatarUrl } from "@/lib/site/storage";
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

  return (
    <>
      <ThemeVars settings={settings} />
      <Shell
        site={{
          settings,
          avatarUrl: publicAvatarUrl(settings.avatarPath),
          isOwner,
        }}
        nowPlaying={nowPlaying}
      />
    </>
  );
}

async function safeSettings(): Promise<SiteSettings> {
  try {
    return await readSiteSettings();
  } catch {
    return DEFAULT_SITE_SETTINGS;
  }
}

async function safeOwner(): Promise<boolean> {
  try {
    return await isOwnerRequest();
  } catch {
    // A missing OWNER_SECRET means owner auth cannot operate. Failing closed
    // is the only safe reading of that.
    return false;
  }
}

async function safeNowPlaying(): Promise<NowPlaying | null> {
  try {
    return await readNowPlaying();
  } catch {
    return null;
  }
}
