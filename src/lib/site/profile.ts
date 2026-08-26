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
  aboutCopy: `I work on web experiences that are useful, interactive, and thoughtfully made.
Here you can find what I have built; what I am exploring; and what I am listening to.`,
  links: [
    { label: "linkedin", href: "https://www.linkedin.com/in/aeironn/" },
    { label: "github", href: "https://github.com/aeironnsarmiento" },
  ],
};
