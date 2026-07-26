import type { NextConfig } from "next";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
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
