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

export const BLUR_DEPTH_CEILING = 1;

const GlassDepthContext = createContext(0);

export function useGlassDepth(): number {
  return useContext(GlassDepthContext);
}

export type GlassTone = "panel" | "raised" | "well";

export type GlassSurfaceProps = {
  as?: ElementType;
  tone?: GlassTone;
  interactive?: boolean;
  radius?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & Record<string, unknown>;

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
