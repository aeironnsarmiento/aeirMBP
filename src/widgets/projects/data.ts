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
  {
    id: "multiplayer-ai",
    title: "multiplayer-ai",
    description:
      "A collaborative workspace where teams chat in shared rooms and work with the same persistent AI thread. Agent runs can plan, research in parallel, and stream their results back to everyone in the room.",
    previewUrl: null,
    href: "https://multiplayer-ai-bay.vercel.app",
    stack: ["Next.js", "Supabase", "AI SDK"],
    palette: { accent: "#f1f3f5", surface: "#292b30" },
  },
];
