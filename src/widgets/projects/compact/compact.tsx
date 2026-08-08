"use client";

import { hueFor } from "@/widgets/music/format";
import { PROJECTS } from "../data";
import styles from "./compact.module.css";

export function ProjectsCompact() {
  return (
    <div className={styles.compactList}>
      {PROJECTS.slice(0, 3).map((project) => (
        <div key={project.id} className={styles.compactItem}>
          <div
            className={styles.compactSwatch}
            style={
              { "--preview-hue": hueFor(project.id) } as React.CSSProperties
            }
            aria-hidden="true"
          />
          <div className={styles.compactMeta}>
            <div className={styles.compactTitle}>{project.title}</div>
            <div className={styles.compactDescription}>
              {project.description}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
