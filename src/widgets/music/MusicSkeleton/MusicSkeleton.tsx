import styles from "./MusicSkeleton.module.css";

export function MusicSkeleton({ rows }: { rows: number }) {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={styles.row} />
      ))}
    </div>
  );
}
