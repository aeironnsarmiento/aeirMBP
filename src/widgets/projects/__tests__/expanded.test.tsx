import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PROJECTS, type Project } from "../data";
import { ProjectsExpanded, ProjectsGallery } from "../expanded/expanded";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "moonbites",
    title: "moonbites",
    description: "A recipe URL scraper and cookbook.",
    previewUrl: null,
    href: "https://moonbites-blue.vercel.app",
    ...overrides,
  };
}

function gallery(count: number) {
  return Array.from({ length: count }, (_, index) =>
    project({ id: `p${index}`, title: `Project ${index}` }),
  );
}

describe("grid layout (AE6)", () => {
  it("lays a single entry out in the same grid the rest will join", () => {
    const { container } = render(<ProjectsGallery projects={gallery(1)} />);

    // No count-dependent variant: one card is a one-cell grid, not a hero.
    expect(container.firstElementChild).not.toHaveAttribute("data-layout");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("renders every entry as the list grows", () => {
    render(<ProjectsGallery projects={gallery(4)} />);

    expect(screen.getAllByRole("link")).toHaveLength(4);
  });
});

describe("outbound links", () => {
  it("opens the target in a new tab with safe rel attributes", () => {
    render(<ProjectsGallery projects={[project()]} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://moonbites-blue.vercel.app");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("shows the destination host so the link is not opaque", () => {
    render(<ProjectsGallery projects={[project()]} />);

    expect(screen.getByText("moonbites-blue.vercel.app")).toBeInTheDocument();
  });
});

describe("preview images", () => {
  it("renders a deliberate fallback when an entry has no preview", () => {
    const { container } = render(<ProjectsGallery projects={[project()]} />);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("MO")).toBeInTheDocument();
  });

  it("renders the preview image when one is supplied", () => {
    render(
      <ProjectsGallery
        projects={[project({ previewUrl: "https://cdn.example/shot.png" })]}
      />,
    );

    expect(screen.getByRole("presentation", { hidden: true })).toBeTruthy();
    expect(document.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.example/shot.png",
    );
  });
});

describe("committed data", () => {
  it("renders the real project list without needing a code change to grow", () => {
    render(<ProjectsExpanded />);

    expect(screen.getAllByRole("link")).toHaveLength(PROJECTS.length);
    expect(screen.getByText("moonbites")).toBeInTheDocument();
  });
});
