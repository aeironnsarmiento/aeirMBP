"use client";

import { GlassSurface } from "@/components/glass/GlassSurface";
import { hueFor, initialsFor } from "@/widgets/music/format";
import { PROJECTS, type Project } from "./data";
import styles from "./projects.module.css";

/** Below this count a grid would read as an unfinished page rather than a gallery. */
export const GRID_THRESHOLD = 3;

export function ProjectsGallery({
  projects,
}: {
  projects: readonly Project[];
}) {
  const layout = projects.length >= GRID_THRESHOLD ? "grid" : "hero";

  return (
    <div className={styles.gallery} data-layout={layout}>
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} layout={layout} />
      ))}
    </div>
  );
}

function ProjectCard({
  project,
  layout,
}: {
  project: Project;
  layout: "hero" | "grid";
}) {
  const host = hostOf(project.href);

  return (
    <GlassSurface
      as="a"
      tone="well"
      interactive
      className={styles.card}
      href={project.href}
      target="_blank"
      // noopener severs window.opener on the opened page; noreferrer keeps the
      // referrer off an outbound link the owner does not control.
      rel="noopener noreferrer"
      data-layout={layout}
      data-testid={`project-${project.id}`}
    >
      <div
        className={styles.preview}
        style={{ "--preview-hue": hueFor(project.id) } as React.CSSProperties}
        aria-hidden="true"
      >
        {initialsFor(project.title)}
        {project.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- avoids the metered image optimizer
          <img
            className={styles.previewImage}
            src={project.previewUrl}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : null}
      </div>

      <div className={styles.body}>
        <div className={styles.title}>
          {project.title}
          <svg
            className={styles.arrow}
            width="11"
            height="11"
            viewBox="0 0 12 12"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 9L9 3M4.4 3H9v4.6" />
          </svg>
        </div>
        <p className={styles.description}>{project.description}</p>
        <span className={styles.host}>{host}</span>
        {project.stack?.length ? (
          <div className={styles.stack}>
            {project.stack.map((tag) => (
              <span key={tag} className={styles.tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </GlassSurface>
  );
}

function hostOf(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}

export function ProjectsExpanded() {
  return <ProjectsGallery projects={PROJECTS} />;
}
