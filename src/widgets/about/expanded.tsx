"use client";

import { GlassSurface } from "@/components/glass/GlassSurface";
import { useSite } from "@/components/shell/SiteContext";
import { PROFILE } from "@/lib/site/profile";
import { initialsFor } from "@/widgets/music/format";
import styles from "./about.module.css";

/**
 * The site's default view (R4).
 *
 * Renders the owner's identity and copy for everyone, from Committed Content
 * rather than from stored settings — so it reads the same for a visitor and
 * the owner, and it is unaffected by the database being unreachable. The
 * avatar still comes from site settings, because it is an uploaded asset.
 */
export function AboutExpanded() {
  const { avatarUrl } = useSite();

  const paragraphs = PROFILE.aboutCopy
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <div className={styles.about}>
      <div className={styles.identity}>
        <Avatar url={avatarUrl} name={PROFILE.name} />
        <h3 className={styles.name}>{PROFILE.name}</h3>
        {PROFILE.handle ? (
          <span className={styles.handle}>@{PROFILE.handle}</span>
        ) : null}
        {PROFILE.location ? (
          <span className={styles.location}>
            <svg
              width="11"
              height="11"
              viewBox="0 0 12 12"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            >
              <path d="M6 11S2 7.6 2 5a4 4 0 1 1 8 0c0 2.6-4 6-4 6Z" />
              <circle cx="6" cy="5" r="1.3" />
            </svg>
            {PROFILE.location}
          </span>
        ) : null}
      </div>

      <div>
        <div className={styles.copy}>
          {paragraphs.length > 0 ? (
            paragraphs.map((block, index) => <p key={index}>{block}</p>)
          ) : (
            // Renders as a deliberate empty state rather than collapsing the
            // two-column layout to nothing.
            <p className={styles.placeholder}>No bio written yet.</p>
          )}
        </div>

        {PROFILE.links.length > 0 ? (
          <div className={styles.links}>
            {PROFILE.links.map((link) => (
              <GlassSurface
                key={`${link.label}-${link.href}`}
                as="a"
                tone="well"
                interactive
                className={styles.link}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.label}
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 9L9 3M4.4 3H9v4.6" />
                </svg>
              </GlassSurface>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  return (
    <div className={styles.avatar}>
      {initialsFor(name)}
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- avoids the metered image optimizer
        <img className={styles.avatarImage} src={url} alt={name} />
      ) : null}
    </div>
  );
}
