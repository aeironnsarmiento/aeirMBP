"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  defaultSubView,
  defaultWidgetId,
  findWidget,
  widgetForHotkey,
} from "@/lib/registry/assemble";
import type { Registry } from "@/lib/registry/types";

/**
 * Which widget is expanded, and the state of its view (R13).
 *
 * One value, not several. No component holds its own open/closed flag, no
 * widget holds its own sub-view, and view parameters are flat strings — which
 * is what keeps a future URL mirror a query-string serialization rather than a
 * rewrite. It is also why nothing survives a refresh: this is React state, and
 * that is the accepted behaviour rather than a defect (AE7).
 */
export type OpenWidgetState = {
  widgetId: string | null;
  subView: string | null;
  params: Readonly<Record<string, string>>;
};

export type OpenWidgetOptions = {
  subView?: string;
  params?: Record<string, string>;
};

export type OpenWidgetApi = {
  state: OpenWidgetState;
  open: (id: string, options?: OpenWidgetOptions) => void;
  close: () => void;
  setSubView: (subView: string) => void;
  setParam: (key: string, value: string) => void;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => unknown;
};

/**
 * Commits a layout-changing state update as one continuous motion (R5).
 *
 * The grid changes both its track counts and which cell each card occupies, so
 * interpolating `grid-template-columns` would snap rather than animate. A view
 * transition animates from a before/after snapshot instead, which handles an
 * arbitrary reflow with no measurement code.
 *
 * `flushSync` is required: the transition callback has to leave the DOM in its
 * final state synchronously, and React's own updates are not.
 *
 * Where the API is absent the state simply changes, which is the same
 * behaviour `prefers-reduced-motion` already asks for (R9) — so the degraded
 * path is a supported path rather than a fallback nobody exercises.
 */
export function commitWithTransition(update: () => void): void {
  const start = (document as ViewTransitionDocument).startViewTransition;

  if (typeof start !== "function") {
    update();
    return;
  }

  start.call(document, () => flushSync(update));
}

/** Keys typed into a field are text, not shortcuts. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function initialState(registry: Registry): OpenWidgetState {
  const id = defaultWidgetId(registry);
  const manifest = findWidget(registry, id);
  return {
    widgetId: id,
    subView: manifest ? defaultSubView(manifest) : null,
    params: {},
  };
}

export function useOpenWidget(registry: Registry): OpenWidgetApi {
  const [state, setState] = useState<OpenWidgetState>(() =>
    initialState(registry),
  );

  const open = useCallback(
    (id: string, options: OpenWidgetOptions = {}) => {
      const manifest = findWidget(registry, id);
      if (!manifest) return;

      // Replacing the value rather than layering onto it is what stops two
      // widgets from being expanded when a hotkey is pressed while one is open.
      commitWithTransition(() =>
        setState({
          widgetId: manifest.id,
          subView: options.subView ?? defaultSubView(manifest),
          params: options.params ?? {},
        }),
      );
    },
    [registry],
  );

  const close = useCallback(() => {
    commitWithTransition(() =>
      setState({ widgetId: null, subView: null, params: {} }),
    );
  }, []);

  const setSubView = useCallback((subView: string) => {
    setState((current) => ({ ...current, subView }));
  }, []);

  const setParam = useCallback((key: string, value: string) => {
    setState((current) => ({
      ...current,
      params: { ...current.params, [key]: value },
    }));
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.key === "Escape") {
        commitWithTransition(() =>
          setState((current) =>
            current.widgetId === null
              ? current
              : { widgetId: null, subView: null, params: {} },
          ),
        );
        return;
      }

      if (event.key.length !== 1) return;

      const manifest = widgetForHotkey(registry, event.key);
      if (!manifest) return;

      event.preventDefault();
      open(manifest.id);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [registry, open]);

  return useMemo(
    () => ({ state, open, close, setSubView, setParam }),
    [state, open, close, setSubView, setParam],
  );
}
