import type { ComponentType } from "react";

export type WidgetSubView = {
  id: string;
  label: string;
};

export type WidgetCompactProps = {
  onExpand: () => void;
};

export type WidgetExpandedProps = {
  subView: string | null;
  setSubView: (subView: string) => void;
  params: Readonly<Record<string, string>>;
  setParam: (key: string, value: string) => void;
};

export type WidgetManifest = {
  id: string;
  title: string;
  tagline?: string;
  hotkey: string;
  order: number;
  icon: ComponentType<{ className?: string }>;
  compact: ComponentType<WidgetCompactProps>;
  expanded: ComponentType<WidgetExpandedProps>;
  span?: "one" | "two";
  subViews?: readonly WidgetSubView[];
  defaultSubView?: string;
  adminOnly?: boolean;
  openByDefault?: boolean;
};

export type Registry = readonly WidgetManifest[];
