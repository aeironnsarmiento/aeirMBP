"use client";

import { toggleTheme } from "../useTheme";
import styles from "./ThemeToggle.module.css";

export function ThemeToggle() {
  return (
    <button
      type="button"
      className={styles.button}
      onClick={() => toggleTheme()}
      aria-label="Toggle light or dark appearance"
      title="Toggle light or dark appearance"
    >
      <svg
        className={`${styles.icon} ${styles.sun}`}
        width="15"
        height="15"
        viewBox="0 0 16 16"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      >
        <circle cx="8" cy="8" r="3.1" />
        <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.1 3.1l1.1 1.1M11.8 11.8l1.1 1.1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1" />
      </svg>
      <svg
        className={`${styles.icon} ${styles.moon}`}
        width="15"
        height="15"
        viewBox="0 0 16 16"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      >
        <path d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.8 5.8 0 1 0 7 7Z" />
      </svg>
    </button>
  );
}
