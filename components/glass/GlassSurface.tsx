"use client";

import {
  createContext,
  useContext,
  useMemo,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";
import "./tokens.css";

/**
 * How many glass surfaces deep a backdrop filter is still allowed.
 *
 * 1 means only the outermost surface in a nesting chain blurs. Stacking
 * backdrop filters is the single most expensive thing this design can do on a
 * phone GPU — each one re-samples and re-blurs everything already composited
 * beneath it — so R6 is enforced structurally rather than by review discipline.
 *
 * Sibling surfaces are unaffected: a dashboard of six glass cards is six
 * independent single-layer blurs, not a six-deep stack.
 */
export const BLUR_DEPTH_CEILING = 1;

const GlassDepthContext = createContext(0);

/** Current nesting depth. 0 means no glass surface is above this point. */
export function useGlassDepth(): number {
  return useContext(GlassDepthContext);
}

/**
 * Restarts the depth count for a subtree.
 *
 * Needed by the modal host: React context flows through portals, so an
 * expanded widget rendered into document.body would otherwise inherit the
 * shell's depth and refuse to blur.
 */
export function GlassDepthReset({ children }: { children: ReactNode }) {
  return (
    <GlassDepthContext.Provider value={0}>
      {children}
    </GlassDepthContext.Provider>
  );
}

export type GlassTone = "panel" | "raised" | "well";

export type GlassSurfaceProps = {
  as?: ElementType;
  tone?: GlassTone;
  /** Adds hover/active affordances and a focus ring. */
  interactive?: boolean;
  /** Overrides the border radius token for this surface. */
  radius?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & Record<string, unknown>;

/**
 * The one glass material (R5). Every translucent panel on the site is this
 * component — blur, tint, border, and shadow are never re-declared elsewhere.
 */
export function GlassSurface({
  as: Tag = "div",
  tone = "panel",
  interactive = false,
  radius,
  className,
  style,
  children,
  ...rest
}: GlassSurfaceProps) {
  const parentDepth = useGlassDepth();
  const depth = parentDepth + 1;
  const blurred = depth <= BLUR_DEPTH_CEILING;

  const contextValue = useMemo(() => depth, [depth]);

  return (
    <GlassDepthContext.Provider value={contextValue}>
      <Tag
        className={className ? `glass ${className}` : "glass"}
        data-blur={blurred ? "on" : "off"}
        data-glass-depth={depth}
        data-tone={tone}
        data-interactive={interactive ? "true" : undefined}
        style={radius ? { borderRadius: radius, ...style } : style}
        {...rest}
      >
        {children}
      </Tag>
    </GlassDepthContext.Provider>
  );
}
