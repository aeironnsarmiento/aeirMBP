"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GlassDepthReset, GlassSurface } from "./GlassSurface";
import styles from "./GlassModal.module.css";

const noopSubscribe = () => () => {};

/**
 * True once hydrated. The portal target does not exist during server render,
 * and About is expanded on first load (R4), so the modal genuinely needs a
 * client-only gate rather than relying on `open` being false initially.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export type GlassModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Rendered between the title and the close control — sub-view tabs, filters. */
  toolbar?: ReactNode;
  children: ReactNode;
};

/**
 * The expanded-widget container (R2, R3).
 *
 * Closes on `esc` and on an explicit control. Depth is reset for the subtree
 * because a portal still inherits React context, and the panel needs to count
 * as the outermost glass surface rather than as one nested inside the shell.
 */
export function GlassModal({
  open,
  onClose,
  title,
  toolbar,
  children,
}: GlassModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<Element | null>(null);
  const hydrated = useHydrated();

  useEffect(() => {
    if (!open) return;

    restoreFocusTo.current = document.activeElement;
    panelRef.current?.focus({ preventScroll: true });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      const target = restoreFocusTo.current;
      if (target instanceof HTMLElement) target.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }

    // Capture phase so `esc` closes the modal before any widget-level handler
    // sees the key and reinterprets it.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!hydrated || !open) return null;

  return createPortal(
    <GlassDepthReset>
      <div className={styles.root} role="presentation">
        <button
          type="button"
          className={styles.scrim}
          aria-label="Close"
          tabIndex={-1}
          onClick={onClose}
        />
        <GlassSurface
          as="div"
          tone="raised"
          className={styles.panel}
          radius="var(--radius-xl)"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          ref={panelRef}
        >
          <header className={styles.head}>
            <h2 className={styles.title}>{title}</h2>
            {toolbar ? <div className={styles.toolbar}>{toolbar}</div> : null}
            <span className={styles.hint} aria-hidden="true">
              esc
            </span>
            <button
              type="button"
              className={styles.close}
              onClick={onClose}
              aria-label={`Close ${title}`}
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
          </header>
          <div className={styles.body}>{children}</div>
        </GlassSurface>
      </div>
    </GlassDepthReset>,
    document.body,
  );
}
