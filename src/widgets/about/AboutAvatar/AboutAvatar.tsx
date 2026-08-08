import { initialsFor } from "@/widgets/music/format";
import styles from "./AboutAvatar.module.css";

export function AboutAvatar({
  url,
  name,
  size = "expanded",
  decorative = false,
}: {
  url: string | null;
  name: string;
  size?: "compact" | "expanded";
  decorative?: boolean;
}) {
  return (
    <div className={styles.avatar} data-size={size}>
      {initialsFor(name)}
      {url ? <img className={styles.image} src={url} alt={decorative ? "" : name} /> : null}
    </div>
  );
}
