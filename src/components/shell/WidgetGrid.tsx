"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { GlassSurface } from "@/components/glass/GlassSurface";
import type { Registry } from "@/lib/registry/types";
import type { WidgetSubView } from "@/lib/registry/types";
import type { OpenWidgetApi } from "./useOpenWidget";
import styles from "./shell.module.css";

const tabId = (widgetId: string, subViewId: string) =>
  `tab-${widgetId}-${subViewId}`;

/**
 * Arrow-key movement within the tab strip (WAI-ARIA tabs pattern).
 *
 * Wraps at both ends, and Home/End jump to the edges. Selection follows focus,
 * which is the right call here: every sub-view is already loaded data, so
 * arrowing through them costs nothing and needs no second keystroke.
 */
function moveThroughTabs(
  event: React.KeyboardEvent<HTMLButtonElement>,
  index: number,
  subViews: readonly WidgetSubView[],
  setSubView: (id: string) => void,
): void {
  const last = subViews.length - 1;
  let next: number | null = null;

  if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
  else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = last;

  if (next === null) return;

  // Otherwise the arrow keys scroll the panel underneath the strip.
  event.preventDefault();
  setSubView(subViews[next].id);

  const strip = event.currentTarget.parentElement;
  (strip?.children[next] as HTMLElement | undefined)?.focus();
}

/**
 * The dashboard, and the expanded widget (R1, R4).
 *
 * A widget expands in place: the open card grows to fill the grid and its
 * siblings compress into a column beside it. There is no portal, no scrim, and
 * no dialog — the shell stays reachable while a widget is open, which is the
 * whole reason for the change (R8).
 *
 * Cards remain siblings inside the frame, so each is a single depth-2 surface
 * rather than a stack (R3).
 */
export function WidgetGrid({
  registry,
  store,
}: {
  registry: Registry;
  store: OpenWidgetApi;
}) {
  const openId = store.state.widgetId;
  const cards = useRef(new Map<string, HTMLElement>());
  const previousOpenId = useRef<string | null>(openId);

  useEffect(() => {
    const collapsed = previousOpenId.current;
    previousOpenId.current = openId;

    // Focus goes back to the card that was open, which is the card the reader
    // was last looking at (R7). The modal used to own this.
    if (openId === null && collapsed !== null) {
      cards.current.get(collapsed)?.focus({ preventScroll: true });
    }
  }, [openId]);

  // The expanded card spans one row per sibling, so the compressed column
  // beside it stays aligned however many widgets the registry holds.
  const siblingCount = Math.max(1, registry.length - 1);

  return (
    <div className={styles.grid} data-expanded={openId ?? undefined}>
      {registry.map((manifest) => {
        const Icon = manifest.icon;
        const Compact = manifest.compact;
        const Expanded = manifest.expanded;
        const expanded = manifest.id === openId;
        const subViews = manifest.subViews ?? [];
        const bodyId = `widget-body-${manifest.id}`;
        const activeSubView = store.state.subView ?? subViews[0]?.id ?? null;

        return (
          <GlassSurface
            key={manifest.id}
            as="article"
            interactive={!expanded}
            className={styles.card}
            data-span={manifest.span ?? "one"}
            data-widget={manifest.id}
            data-state={expanded ? "expanded" : "compact"}
            style={
              {
                // Every card is named so the browser can pair it across the
                // transition; only the open one claims the extra rows.
                viewTransitionName: `widget-${manifest.id}`,
                ...(expanded && { gridRow: `1 / span ${siblingCount}` }),
              } as CSSProperties
            }
            role={expanded ? "region" : "button"}
            tabIndex={expanded ? -1 : 0}
            aria-label={expanded ? manifest.title : `Open ${manifest.title}`}
            aria-expanded={expanded ? undefined : false}
            ref={(node: HTMLElement | null) => {
              if (node) cards.current.set(manifest.id, node);
              else cards.current.delete(manifest.id);
            }}
            onClick={expanded ? undefined : () => store.open(manifest.id)}
            onKeyDown={
              expanded
                ? undefined
                : (event: React.KeyboardEvent) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    store.open(manifest.id);
                  }
            }
          >
            <header className={styles.cardHead}>
              <Icon className={styles.cardIcon} />
              <h2 className={styles.cardTitle}>{manifest.title}</h2>

              {expanded && subViews.length > 0 ? (
                // Driven by the manifest, as the modal header was, so the
                // shell still names no widget (R14).
                <div
                  className={styles.tabs}
                  role="tablist"
                  aria-label={`${manifest.title} views`}
                >
                  {subViews.map((subView, index) => {
                    const selected = subView.id === activeSubView;
                    return (
                      <button
                        key={subView.id}
                        type="button"
                        role="tab"
                        id={tabId(manifest.id, subView.id)}
                        className={styles.tab}
                        aria-selected={selected}
                        aria-controls={bodyId}
                        // Roving tabindex: the strip is one tab stop and the
                        // arrow keys move within it, rather than every view
                        // sitting in the page's tab order.
                        tabIndex={selected ? 0 : -1}
                        onClick={() => store.setSubView(subView.id)}
                        onKeyDown={(event) =>
                          moveThroughTabs(event, index, subViews, store.setSubView)
                        }
                      >
                        {subView.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {expanded ? (
                <>
                  <span className={styles.cardHint} aria-hidden="true">
                    esc
                  </span>
                  <button
                    type="button"
                    className={styles.cardClose}
                    aria-expanded
                    aria-controls={bodyId}
                    aria-label={`Collapse ${manifest.title}`}
                    onClick={store.close}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    >
                      <path d="M2 2l8 8M10 2l-8 8" />
                    </svg>
                  </button>
                </>
              ) : (
                <kbd className={styles.hotkey}>{manifest.hotkey}</kbd>
              )}
            </header>

            <div
              className={styles.cardBody}
              id={bodyId}
              // A tablist without a panel is half the pattern: the tabs would
              // announce a selection that points at nothing. tabIndex makes
              // the panel reachable so a keyboard user can scroll it.
              role={expanded && subViews.length > 0 ? "tabpanel" : undefined}
              aria-labelledby={
                expanded && activeSubView
                  ? tabId(manifest.id, activeSubView)
                  : undefined
              }
              tabIndex={expanded && subViews.length > 0 ? 0 : undefined}
            >
              {expanded ? (
                <Expanded
                  subView={store.state.subView}
                  setSubView={store.setSubView}
                  params={store.state.params}
                  setParam={store.setParam}
                  openWidget={store.open}
                />
              ) : (
                <Compact onExpand={() => store.open(manifest.id)} />
              )}
            </div>

            {!expanded && manifest.tagline ? (
              <p className={styles.cardTagline}>{manifest.tagline}</p>
            ) : null}
          </GlassSurface>
        );
      })}
    </div>
  );
}
