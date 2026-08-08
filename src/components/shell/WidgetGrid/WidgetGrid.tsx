"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { GlassSurface } from "@/components/glass/GlassSurface";
import type { Registry } from "@/lib/registry/types";
import type { WidgetSubView } from "@/lib/registry/types";
import type { OpenWidgetApi } from "../useOpenWidget";
import { WidgetHotkey } from "../WidgetHotkey/WidgetHotkey";
import styles from "./WidgetGrid.module.css";

const tabId = (widgetId: string, subViewId: string) =>
  `tab-${widgetId}-${subViewId}`;

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

  event.preventDefault();
  setSubView(subViews[next].id);

  const strip = event.currentTarget.parentElement;
  (strip?.children[next] as HTMLElement | undefined)?.focus();
}

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
    const previous = previousOpenId.current;
    previousOpenId.current = openId;

    if (previous === openId) return;

    if (openId === null) {
      if (previous !== null) {
        cards.current.get(previous)?.focus({ preventScroll: true });
      }
      return;
    }

    cards.current.get(openId)?.focus({ preventScroll: true });
  }, [openId]);

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
                <WidgetHotkey>{manifest.hotkey}</WidgetHotkey>
              )}
            </header>

            <div
              className={styles.cardBody}
              id={bodyId}
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
