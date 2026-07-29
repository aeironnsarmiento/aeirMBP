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
 * The transition currently running, or the tail of the queue behind it.
 *
 * Starting a transition while one is in flight *aborts* it, and an aborted one
 * stops wherever it had got to — with translucent surfaces the snapshots
 * freeze part-faded and the wallpaper reads through until something forces a
 * repaint. So transitions queue rather than interrupt, and two quick hotkeys
 * play two expansions in order instead of one broken one.
 */
let tail: Promise<void> | null = null;

/** Test seam, mirroring `clearNowPlayingCache`. Not called by the shell. */
export function clearPendingTransitions(): void {
  tail = null;
}

/**
 * Runs `work` once nothing is transitioning (KTD9). A theme write landing
 * while frozen snapshots paint either arrives as a hard cut or cross-fades an
 * old-theme wallpaper against a new-theme one — and the settled state looks
 * correct either way. Re-checks, because a transition may queue behind the
 * one being awaited.
 */
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
  // When nothing is running, `run` is called synchronously — the state change
  // must not wait on a microtask, and a `startViewTransition` that throws has
  // to keep throwing from this call rather than becoming an unhandled
  // rejection.
  const next = tail === null ? run() : tail.then(run);
  tail = next;

  const release = () => {
    if (tail === next) tail = null;
  };
  void next.then(release, release);
}

/**
 * How the shell wants a transition paired, not how fast it runs.
 *
 * A `morph` grows or shrinks one widget between its compact and expanded boxes
 * (R5). A `swap` replaces one expanded widget with another, and pairs both
 * panes into one stationary group — see `[data-vt-swap]` in globals.css for
 * why leaving it as two morphs reads as wreckage.
 */
export type TransitionKind = "morph" | "swap";

/**
 * Commits a layout-changing state update as one continuous motion (R5).
 *
 * The grid changes track counts and cell assignments at once, so interpolating
 * `grid-template-columns` would snap; a snapshot-driven transition handles an
 * arbitrary reflow with no measurement code.
 *
 * `flushSync` is required — the callback must leave the DOM in its final state
 * synchronously, and React's updates are not. Where the API is absent the
 * state simply changes, which is what `prefers-reduced-motion` already asks
 * for (R9), so the degraded path is a supported one.
 */
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
    /*
     * The attribute goes on when this transition actually starts — inside the
     * queued task, not at call time — because a queued swap must not have its
     * attribute stripped by the finish of the transition ahead of it. It is
     * present for both captures (the old capture happens synchronously inside
     * `start`, the new one after `flushSync`), which is what lets the
     * stationary-pair rule in globals.css rename both expanded cards.
     */
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

    /*
     * Both promises get a handler that ignores rejection. A skip rejects them
     * and a skip is ordinary — the spec skips outright on a hidden document,
     * so every expansion on a backgrounded tab lands here. Unhandled it was a
     * console error for a non-event. The state change is never at risk:
     * `flushSync` already committed it, so a skip costs only the animation.
     */
    Promise.resolve(transition?.ready).catch(() => {});

    // Only `finished` gates the queue — `ready` resolves at the first frame,
    // which is too early to know the previous motion has cleared. The swap
    // attribute clears on the same edge, settled or skipped, so a stale flag
    // can never re-pair a later morph.
    return Promise.resolve(transition?.finished).then(clear, clear);
  });
}

/** Whether two param maps carry the same keys and values. */
function sameParams(
  current: Readonly<Record<string, string>>,
  next: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(current);
  if (keys.length !== Object.keys(next).length) return false;
  return keys.every((key) => current[key] === next[key]);
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

  // Closes over the open widget id, so it is re-created when that changes —
  // the hotkey listener re-binds, which is cheap, and every consumer already
  // re-renders with the state this hook owns.
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

      /*
       * A request landing on the state already showing is not a transition —
       * animating it costs `--dur-slow` to arrive back where it started.
       * Compared against the whole resulting state rather than the id alone,
       * so pressing an open widget's key still resets its sub-view.
       */
      if (
        state.widgetId === next.widgetId &&
        state.subView === next.subView &&
        sameParams(state.params, next.params)
      ) {
        return;
      }

      // Expanded → expanded is a swap: both panes hold the same grid cell, so
      // they pair into one stationary group instead of flying two morphs
      // across the grid. Dashboard → expanded keeps the growing morph.
      const kind: TransitionKind =
        openWidgetId !== null && openWidgetId !== manifest.id
          ? "swap"
          : "morph";

      // Replacing the value rather than layering onto it is what stops two
      // widgets from being expanded when a hotkey is pressed while one is open.
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
      /*
       * Holding a key is one intent, not thirty. The OS repeats keydown at
       * roughly 30 a second, and every repeat used to queue a full transition
       * behind the last — a two-second hold left the shell animating for half
       * a minute. The queue is right; the flood was upstream of it.
       */
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
