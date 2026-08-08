import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PROJECTS, type Project } from "../data";
import { GRID_THRESHOLD, ProjectsExpanded, ProjectsGallery } from "../expanded/expanded";

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

describe("layout by entry count (AE6)", () => {
  it("presents a single entry as a hero rather than a one-cell grid", () => {
    const { container } = render(<ProjectsGallery projects={gallery(1)} />);

    expect(container.firstElementChild).toHaveAttribute("data-layout", "hero");
  });

  it("keeps the hero treatment at two entries", () => {
    const { container } = render(<ProjectsGallery projects={gallery(2)} />);

    expect(container.firstElementChild).toHaveAttribute("data-layout", "hero");
  });

  it("switches to a grid once there are enough entries to fill one", () => {
    const { container } = render(
      <ProjectsGallery projects={gallery(GRID_THRESHOLD)} />,
    );

    expect(container.firstElementChild).toHaveAttribute("data-layout", "grid");
  });

  it("renders every entry in either layout", () => {
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
