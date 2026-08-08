import type { ReactNode } from "react";
import styles from "./SettingsSection.module.css";

export function SettingsSection({
  title,
  note,
  children,
}: {
  title?: ReactNode;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      {title || note ? (
        <div className={styles.head}>
          {title ? <span className={styles.title}>{title}</span> : null}
          {note ? <SettingsNote>{note}</SettingsNote> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function SettingsNote({ children }: { children: ReactNode }) {
  return <span className={styles.note}>{children}</span>;
}
