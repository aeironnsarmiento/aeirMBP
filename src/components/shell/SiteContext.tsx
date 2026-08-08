"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SiteSettings } from "@/lib/site/schema";
import type { BackgroundSlots } from "@/lib/theme/backgrounds";

export type SiteContextValue = {
  settings: SiteSettings;
  avatarUrl: string | null;
  backgrounds: BackgroundSlots;
  isOwner: boolean;
};

const SiteContext = createContext<SiteContextValue | null>(null);

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
