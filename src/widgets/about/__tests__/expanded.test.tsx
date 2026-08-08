import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteProvider } from "@/components/shell/SiteContext";
import { siteFixture } from "@/components/shell/testSite";
import { PROFILE } from "@/lib/site/profile";
import { AboutExpanded } from "../expanded/expanded";

function about(isOwner = false) {
  return render(
    <SiteProvider value={siteFixture({ isOwner })}>
      <AboutExpanded />
    </SiteProvider>,
  );
}

describe("committed content (AE1)", () => {
  it("renders the profile's identity and copy", () => {
    about();

    expect(screen.getByRole("heading", { name: PROFILE.name })).toBeVisible();
    expect(screen.getByText(`@${PROFILE.handle}`)).toBeVisible();
    expect(screen.getByText(PROFILE.location)).toBeVisible();
    expect(screen.getByText(PROFILE.aboutCopy)).toBeVisible();
  });

  it("renders every committed link, opening off-site", () => {
    about();

    expect(screen.getAllByRole("link")).toHaveLength(PROFILE.links.length);

    for (const link of PROFILE.links) {
      const anchor = screen.getByRole("link", { name: link.label });
      expect(anchor).toHaveAttribute("href", link.href);
      expect(anchor).toHaveAttribute("rel", "noopener noreferrer");
    }
  });
});

describe("no owner surface (AE2)", () => {
  it("renders identically for the owner, with no edit affordance", () => {
    const visitor = about(false).container.innerHTML;
    const owner = about(true).container.innerHTML;

    expect(owner).toBe(visitor);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("independence from stored settings (AE4)", () => {
  it("renders full content when settings are the degraded defaults", () => {
    about();

    expect(screen.getByRole("heading", { name: PROFILE.name })).toBeVisible();
    expect(screen.getByText(PROFILE.aboutCopy)).toBeVisible();
  });
});
