export type Project = {
  id: string;
  title: string;
  description: string;
  previewUrl: string | null;
  href: string;
  stack?: readonly string[];
};

export const PROJECTS: readonly Project[] = [
  {
    id: "moonbites",
    title: "moonbites",
    description:
      "A recipe URL scraper and cookbook. Paste a link from anywhere and it pulls out the actual recipe — ingredients, steps, timings — and keeps it somewhere you can find it again.",
    previewUrl: null,
    href: "https://moonbites-blue.vercel.app",
    stack: ["Next.js", "Vercel", "scraping"],
  },
];
