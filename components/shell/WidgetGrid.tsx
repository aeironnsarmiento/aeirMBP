"use client";

import { GlassSurface } from "@/components/glass/GlassSurface";
import type { Registry } from "@/lib/registry/types";
import styles from "./shell.module.css";

/**
 * The dashboard (R1, R2).
 *
 * One card per registry entry, each rendering that widget's own compact view.
 * Cards are siblings, so each is a single blur layer rather than a stack (R6).
 */
export function WidgetGrid({
  registry,
  onOpen,
}: {
  registry: Registry;
  onOpen: (id: string) => void;
}) {
  return (
    <div className={styles.grid}>
      {registry.map((manifest) => {
        const Icon = manifest.icon;
        const Compact = manifest.compact;

        return (
          <GlassSurface
            key={manifest.id}
            as="article"
            interactive
            className={styles.card}
            data-span={manifest.span ?? "one"}
            data-widget={manifest.id}
            role="button"
            tabIndex={0}
            aria-label={`Open ${manifest.title}`}
            onClick={() => onOpen(manifest.id)}
            onKeyDown={(event: React.KeyboardEvent) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onOpen(manifest.id);
            }}
          >
            <header className={styles.cardHead}>
              <Icon className={styles.cardIcon} />
              <h2 className={styles.cardTitle}>{manifest.title}</h2>
              <kbd className={styles.hotkey}>{manifest.hotkey}</kbd>
            </header>

            <div className={styles.cardBody}>
              <Compact onExpand={() => onOpen(manifest.id)} />
            </div>

            {manifest.tagline ? (
              <p className={styles.cardTagline}>{manifest.tagline}</p>
            ) : null}
          </GlassSurface>
        );
      })}
    </div>
  );
}
