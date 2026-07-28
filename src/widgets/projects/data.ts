export type Project = {
  id: string;
  title: string;
  description: string;
  /** Null renders a deliberate fallback rather than a broken image. */
  previewUrl: string | null;
  href: string;
  /** Short tags shown under the description. */
  stack?: readonly string[];
};

/**
 * Committed data, not database rows.
 *
 * There is one entry and no requirement to edit projects at runtime, so a
 * table, a query layer and an editing surface would all be built for a list
 * that changes a few times a year. Adding an entry is a one-line diff.
 */
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
