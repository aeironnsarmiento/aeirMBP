/**
 * The two colours that make a project's site recognisable at a glance: the
 * background it is mostly painted in, and the saturated mark it accents with.
 * Sampled from the live site by `docs/scripts/project-palette.mjs` and
 * committed here, so the swatch renders with no network call and keeps working
 * when the target site does not.
 */
export type ProjectPalette = {
  accent: string;
  surface: string;
};

export type Project = {
  id: string;
  title: string;
  description: string;
  previewUrl: string | null;
  href: string;
  stack?: readonly string[];
  palette?: ProjectPalette;
};

export const PROJECTS: readonly Project[] = [
  {
    id: "moonbites",
    title: "moonbites",
    description:
      "A recipe URL scraper and cookbook. Paste a link from anywhere and it pulls out the actual recipe — ingredients, steps, timings — and keeps it somewhere you can find it again.",
    previewUrl: "/backgrounds/moonbites.png",
    href: "https://moonbites-blue.vercel.app",
    stack: ["Next.js", "Vercel", "scraping"],
    palette: { accent: "#68784a", surface: "#f0f4e2" },
  },
];
