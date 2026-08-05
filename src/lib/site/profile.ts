export type SiteLink = { label: string; href: string };

export type SiteProfile = {
  /** Display name, shown in the sidebar profile block and the About widget. */
  name: string;
  /** Rendered as `@handle` in the top bar brand and the sidebar. */
  handle: string;
  /** Blank renders nothing rather than an empty row. */
  location: string;
  /** Blank lines separate paragraphs when rendered. */
  aboutCopy: string;
  links: readonly SiteLink[];
};

/**
 * The site's written identity — Committed Content, not database rows.
 *
 * This is prose the owner writes a few times a year, so a table, a query
 * layer, a guarded endpoint and an editing surface would all be built for
 * something that changes less often than the code around it. Editing it is a
 * commit, the same as `widgets/projects/data.ts`.
 *
 * Deliberately free of any database import, and carrying no `"use client"`
 * directive. The shell reads `name` and `handle`, the About widget reads all
 * five, and both are client components — a directive here would hand a server
 * component a client reference instead of this object, and the fields would
 * read as undefined rather than failing loudly.
 *
 * Links are authored here rather than validated at runtime. There is no
 * validator on this path, so an `href` that is not `http(s)` is a review-time
 * concern.
 */
export const PROFILE: SiteProfile = {
  name: "Aeironn Sarmiento",
  handle: "xenavalon",
  location: "Richardson, TX | Conroe, TX",
  aboutCopy:
    "I build things for the web and listen to a lot of music. This site is a desktop: every tab is a widget you can open, and the music one runs on my own scrobble history rather than someone else's dashboard.",
  links: [
    { label: "linkedin", href: "https://www.linkedin.com/in/aeironn/" },
    { label: "github", href: "https://github.com/aeironnsarmiento" },
  ],
};
