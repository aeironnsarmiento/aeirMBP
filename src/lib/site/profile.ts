export type SiteLink = { label: string; href: string };

export type SiteProfile = {
  name: string;
  handle: string;
  location: string;
  aboutCopy: string;
  links: readonly SiteLink[];
};

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
