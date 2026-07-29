import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { THEME_COLORS } from "@/components/glass/themeContract";
import "./globals.css";

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "xenavalon",
  description: "A personal site shaped like a liquid-glass desktop.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The pre-hydration default, and the answer for a reader with no preference
  // (R12). The theme module prepends a media-less one when an appearance
  // resolves, and the first *matching* in tree order wins.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // ThemeVars renders the pre-paint script that writes data-theme here, from
    // the page rather than this layout: it reads request state, and this layout
    // wraps the built-in not-found response.
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      {/*
        Extensions mutate the body before React loads — a video-speed
        controller adds `vsc-initialized`, ad blockers add their own marks.
        None of it comes from this app and no change here can prevent it, so
        the warning is suppressed at the element being mutated (R24).
        Suppression covers one level only, so a real mismatch inside the shell
        still reports.
      */}
      <body suppressHydrationWarning>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
