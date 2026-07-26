import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

/**
 * Every LAN address this machine currently answers on.
 *
 * `next dev` gates cross-origin dev requests: reaching the server by IP from a
 * phone on the same Wi-Fi serves the HTML but refuses the dev client, so the
 * page renders and then never hydrates — it looks like a dead UI rather than a
 * blocked request. Enumerating the interfaces means this keeps working when
 * DHCP hands out a different address.
 *
 * Development only; Next ignores the option in a production build.
 */
const lanOrigins = Object.values(networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
  .map((entry) => entry!.address);

const nextConfig: NextConfig = {
  allowedDevOrigins: lanOrigins,
  images: {
    remotePatterns: [
      // Deezer cover art (enrichment)
      { protocol: "https", hostname: "*.dzcdn.net" },
      { protocol: "https", hostname: "e-cdns-images.dzcdn.net" },
      // Cover Art Archive (MusicBrainz fallback)
      { protocol: "https", hostname: "coverartarchive.org" },
      { protocol: "https", hostname: "*.archive.org" },
      // last.fm images (live now-playing surface)
      { protocol: "https", hostname: "lastfm.freetls.fastly.net" },
      // Supabase Storage (avatar)
      ...(supabaseHost
        ? [{ protocol: "https" as const, hostname: supabaseHost }]
        : []),
    ],
  },
};

export default nextConfig;
