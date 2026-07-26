"use client";

import { GlassModal } from "@/components/glass/GlassModal";
import { findWidget } from "@/lib/registry/assemble";
import type { Registry } from "@/lib/registry/types";
import type { OpenWidgetApi } from "./useOpenWidget";
import styles from "./ModalHost.module.css";

/**
 * Renders whichever widget the store says is open (R2, R3).
 *
 * Generic over the registry: it looks the manifest up by id and renders its
 * expanded component, so no widget is named here (R14). Sub-view tabs come
 * from the manifest rather than from each widget, which keeps the switcher
 * consistent across widgets and the manifest thin.
 */
export function ModalHost({
  registry,
  store,
}: {
  registry: Registry;
  store: OpenWidgetApi;
}) {
  const manifest = findWidget(registry, store.state.widgetId);
  if (!manifest) return null;

  const Expanded = manifest.expanded;
  const subViews = manifest.subViews ?? [];

  return (
    <GlassModal
      open
      onClose={store.close}
      title={manifest.title}
      toolbar={
        subViews.length > 0 ? (
          <div className={styles.tabs} role="tablist" aria-label={`${manifest.title} views`}>
            {subViews.map((subView) => (
              <button
                key={subView.id}
                type="button"
                role="tab"
                className={styles.tab}
                aria-selected={subView.id === store.state.subView}
                onClick={() => store.setSubView(subView.id)}
              >
                {subView.label}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      <Expanded
        subView={store.state.subView}
        setSubView={store.setSubView}
        params={store.state.params}
        setParam={store.setParam}
        openWidget={store.open}
      />
    </GlassModal>
  );
}
