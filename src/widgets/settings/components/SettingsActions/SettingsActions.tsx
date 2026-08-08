import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./SettingsActions.module.css";

export function SettingsActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}

export function SettingsButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={[styles.button, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export function SettingsStatus({
  tone,
  children,
}: {
  tone: "ok" | "error";
  children: ReactNode;
}) {
  return (
    <span className={styles.status} data-tone={tone}>
      {children}
    </span>
  );
}
