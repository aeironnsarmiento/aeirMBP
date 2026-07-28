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
 * Starting a view transition while one is in flight does not replace it — it
 * *aborts* it, and an aborted transition stops wherever it had got to. With
 * translucent surfaces that is not a subtle glitch: the snapshots freeze
 * part-faded and the wallpaper reads straight through the shell until
 * something else forces a repaint. It surfaces in the console as
 * `InvalidStateError: Transition was aborted because of invalid state`, which
 * names the mechanism but not the consequence.
 *
 * So transitions queue rather than interrupt. Pressing two hotkeys quickly
 * plays two expansions in order instead of one broken one.
 */
let tail: Promise<void> | null = null;

/** Test seam, mirroring `clearNowPlayingCache`. Not called by the shell. */
export function clearPendingTransitions(): void {
  tail = null;
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
 * A `morph` grows or shrinks one widget between its compact and expanded
 * boxes — the R5 signature motion, driven by the per-widget names the grid
 * writes inline. A `swap` replaces one expanded widget with another: both big
 * panes occupy the same grid cell, so pairing them into one stationary group
 * (see `[data-vt-swap]` in globals.css) cross-fades them in place. Left as two
 * morphs, a swap flies both translucent panes across the grid at once — the
 * outgoing pane vacates bare frame, the incoming one drags a zoomed ghost of
 * its compact self, and for the length of the flight the shell reads as
 * transparent wreckage rather than a machine changing mode.
 */
export type TransitionKind = "morph" | "swap";

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
     * Both promises get a handler, and both handlers ignore rejection.
     *
     * A skipped transition rejects them, and a skip is ordinary: the spec
     * skips one outright whenever the document is hidden, so every expansion
     * on a backgrounded tab takes this path. Left unhandled it surfaced as
     * `unhandledRejection: InvalidStateError: Transition was aborted because
     * of invalid state` — a real console error for a non-event, which is
     * exactly the kind of noise that trains an owner to ignore the console.
     *
     * The state change itself is never at risk. `flushSync` has already
     * committed it inside the callback; a skip costs the animation, nothing
     * more.
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
       * A request that lands on the state already showing is not a transition.
       * It is a keypress naming where the reader already is, and animating it
       * costs `--dur-slow` to arrive back where it started.
       *
       * The comparison is against the whole resulting state rather than the id
       * alone, so pressing an open widget's own key still resets it to its
       * default sub-view — that is a real change and keeps working.
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
       * roughly 30 a second after its initial delay, and every repeat used to
       * reach `open` and queue a full transition behind the last — a two-second
       * hold left the shell animating for half a minute and the page
       * unresponsive while it worked through the backlog.
       *
       * The queue itself is right; the flood was upstream of it.
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
