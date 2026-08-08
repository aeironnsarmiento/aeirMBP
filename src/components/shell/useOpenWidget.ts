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

let tail: Promise<void> | null = null;

export function clearPendingTransitions(): void {
  tail = null;
}

export function afterTransitions(work: () => void): void {
  const pending = tail;
  if (pending === null) {
    work();
    return;
  }

  const retry = () => afterTransitions(work);
  void pending.then(retry, retry);
}

function enqueue(run: () => Promise<void>): void {
  const next = tail === null ? run() : tail.then(run);
  tail = next;

  const release = () => {
    if (tail === next) tail = null;
  };
  void next.then(release, release);
}

export type TransitionKind = "morph" | "swap";

export function commitWithTransition(
  update: () => void,
  kind: TransitionKind = "morph",
): void {
  const start = (document as ViewTransitionDocument).startViewTransition;

  if (typeof start !== "function") {
    update();
    return;
  }

  enqueue(() => {
    if (kind === "swap") {
      document.documentElement.setAttribute("data-vt-swap", "");
    }
    const clear = () => {
      if (kind === "swap") {
        document.documentElement.removeAttribute("data-vt-swap");
      }
    };

    let transition:
      | { ready?: Promise<unknown>; finished?: Promise<unknown> }
      | undefined;
    try {
      transition = start.call(document, () => flushSync(update)) as
        | { ready?: Promise<unknown>; finished?: Promise<unknown> }
        | undefined;
    } catch (error) {
      clear();
      throw error;
    }

    Promise.resolve(transition?.ready).catch(() => {});

    return Promise.resolve(transition?.finished).then(clear, clear);
  });
}

function sameParams(
  current: Readonly<Record<string, string>>,
  next: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(current);
  if (keys.length !== Object.keys(next).length) return false;
  return keys.every((key) => current[key] === next[key]);
}

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

  const openWidgetId = state.widgetId;

  const open = useCallback(
    (id: string, options: OpenWidgetOptions = {}) => {
      const manifest = findWidget(registry, id);
      if (!manifest) return;

      const next: OpenWidgetState = {
        widgetId: manifest.id,
        subView: options.subView ?? defaultSubView(manifest),
        params: options.params ?? {},
      };

      if (
        state.widgetId === next.widgetId &&
        state.subView === next.subView &&
        sameParams(state.params, next.params)
      ) {
        return;
      }

      const kind: TransitionKind =
        openWidgetId !== null && openWidgetId !== manifest.id
          ? "swap"
          : "morph";

      commitWithTransition(() => setState(next), kind);
    },
    [registry, openWidgetId, state],
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
      if (event.repeat) return;
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
