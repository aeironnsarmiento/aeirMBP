import type { ComponentType } from "react";

/**
 * A sub-view is a named surface inside an expanded widget — Music's recently
 * played / top artists / top albums / top tracks. The shell renders the
 * switcher; the widget renders the content for the active id.
 */
export type WidgetSubView = {
  id: string;
  label: string;
};

export type WidgetCompactProps = {
  /** Expands this widget. Passed down so a compact view can offer its own affordance. */
  onExpand: () => void;
};

export type WidgetExpandedProps = {
  /** The active sub-view id, or null when the widget declares no sub-views. */
  subView: string | null;
  setSubView: (subView: string) => void;
  /**
   * Widget-scoped view parameters — Music's time range, for example.
   *
   * Held in the same single store value as the open widget and its sub-view,
   * never in component state (R13). Keeping them as flat strings is what makes
   * a future URL mirror a query-string serialization rather than a rewrite.
   */
  params: Readonly<Record<string, string>>;
  setParam: (key: string, value: string) => void;
  /**
   * Expands another widget.
   *
   * A shell capability, not a widget-to-widget dependency: the caller passes an
   * id string, never an import. This is how Settings surfaces About's own
   * editor rather than growing a second copy of it.
   */
  openWidget: (
    id: string,
    options?: { subView?: string; params?: Record<string, string> },
  ) => void;
};

/**
 * Everything the shell needs to know about a widget (R12).
 *
 * Deliberately thin. A manifest that starts carrying behaviour is the signal
 * that a plugin framework is being built for four widgets.
 */
export type WidgetManifest = {
  /** Stable identifier. Also the key used in the open-widget store. */
  id: string;
  /** Navigation and modal heading. */
  title: string;
  /** One line under the title on the compact card. */
  tagline?: string;
  /** Single character, shown beside the navigation entry and bound as a shortcut. */
  hotkey: string;
  /** Sort position in navigation and in the widget grid. */
  order: number;
  icon: ComponentType<{ className?: string }>;
  compact: ComponentType<WidgetCompactProps>;
  expanded: ComponentType<WidgetExpandedProps>;
  /** Grid footprint on the dashboard. Defaults to one column. */
  span?: "one" | "two";
  subViews?: readonly WidgetSubView[];
  /**
   * Which sub-view opens first. Defaults to the first declared.
   *
   * Set it when presentation order and default differ — the strip reads in DOM
   * order so that keyboard and screen-reader order match what is on screen,
   * which leaves this as the only honest way to open on a later view.
   */
  defaultSubView?: string;
  /** Removed from the registry entirely for an unauthenticated caller (R16). */
  adminOnly?: boolean;
  /**
   * Expanded on first load. Exactly one manifest may set this — the shell must
   * not name a widget to know which one opens by default (R4, R14).
   */
  openByDefault?: boolean;
};

export type Registry = readonly WidgetManifest[];
