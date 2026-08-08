import type { ReactNode } from "react";
import styles from "./WidgetHotkey.module.css";

export function WidgetHotkey({ children }: { children: ReactNode }) {
  return <kbd className={styles.hotkey}>{children}</kbd>;
}
