"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SiteSettings } from "@/lib/site/schema";

export type SiteContextValue = {
  settings: SiteSettings;
  avatarUrl: string | null;
  /** Whether this request carries a valid owner session (R16). */
  isOwner: boolean;
};

const SiteContext = createContext<SiteContextValue | null>(null);

/**
 * Owner-authored state, resolved once on the server and shared with every
 * widget.
 *
 * A context rather than props because the shell renders widgets by iterating
 * the registry and must not know which one needs what (R14). Any widget that
 * needs the owner's settings reads them here.
 */
export function SiteProvider({
  value,
  children,
}: {
  value: SiteContextValue;
  children: ReactNode;
}) {
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export function useSite(): SiteContextValue {
  const value = useContext(SiteContext);
  if (!value) {
    throw new Error("useSite must be used inside the shell's SiteProvider");
  }
  return value;
}
