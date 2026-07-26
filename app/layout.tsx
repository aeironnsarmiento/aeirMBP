import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { THEME_BOOT_SCRIPT } from "@/components/glass/useTheme";
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9edf5" },
    { media: "(prefers-color-scheme: dark)", color: "#12161f" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The boot script writes data-theme onto this element before hydration.
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script
          // Runs ahead of first paint so a visitor with a stored dark
          // preference never sees a light frame. Absent a stored choice it
          // writes nothing and prefers-color-scheme stays in charge (R9).
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      {/*
        Extensions mutate the body before React loads — a video-speed
        controller adds `vsc-initialized`, ad blockers add their own marks.
        None of it comes from this app and no change here can prevent it, so
        the warning is suppressed at the element being mutated (R24).
        Suppression covers one level only, so a real mismatch inside the shell
        still reports.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
