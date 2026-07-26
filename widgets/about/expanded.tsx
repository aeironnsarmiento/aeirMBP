"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GlassSurface } from "@/components/glass/GlassSurface";
import { useSite } from "@/components/shell/SiteContext";
import type { WidgetExpandedProps } from "@/lib/registry/types";
import type { SiteLink, SiteSettings } from "@/lib/site/schema";
import { initialsFor } from "@/widgets/music/format";
import styles from "./about.module.css";

/**
 * The site's default view (R4).
 *
 * Renders the owner's identity and copy for everyone, and an editing form for
 * the owner (R17, R19). Both read the same server-resolved settings, so a save
 * followed by a router refresh is all it takes for a visitor to see the change.
 */
export function AboutExpanded({ params, setParam }: WidgetExpandedProps) {
  const { settings, avatarUrl, isOwner } = useSite();
  // Edit mode lives in the open-widget store like every other view state (R13),
  // which is also what lets Settings open About straight into it.
  const editing = isOwner && params.edit === "1";

  return (
    <div>
      {isOwner ? (
        <div className={styles.ownerBar}>
          <span className={styles.ownerTag}>Owner</span>
          <button
            type="button"
            className={styles.link}
            onClick={() => setParam("edit", editing ? "0" : "1")}
          >
            {editing ? "Done editing" : "Edit About"}
          </button>
        </div>
      ) : null}

      {editing ? (
        <AboutForm settings={settings} onDone={() => setParam("edit", "0")} />
      ) : (
        <AboutView settings={settings} avatarUrl={avatarUrl} />
      )}
    </div>
  );
}

function AboutView({
  settings,
  avatarUrl,
}: {
  settings: SiteSettings;
  avatarUrl: string | null;
}) {
  const paragraphs = settings.aboutCopy
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <div className={styles.about}>
      <div className={styles.identity}>
        <Avatar url={avatarUrl} name={settings.name} />
        <h3 className={styles.name}>{settings.name || "Unnamed"}</h3>
        {settings.handle ? (
          <span className={styles.handle}>@{settings.handle}</span>
        ) : null}
        {settings.location ? (
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
            {settings.location}
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

        {settings.links.length > 0 ? (
          <div className={styles.links}>
            {settings.links.map((link) => (
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
      {initialsFor(name || "?")}
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- avoids the metered image optimizer
        <img className={styles.avatarImage} src={url} alt={name} />
      ) : null}
    </div>
  );
}

/** `label|https://url` per line — an array editor for two links is overbuilt. */
function linksToText(links: readonly SiteLink[]): string {
  return links.map((link) => `${link.label}|${link.href}`).join("\n");
}

function textToLinks(text: string): SiteLink[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("|");
      if (separator === -1) return { label: line, href: line };
      return {
        label: line.slice(0, separator).trim(),
        href: line.slice(separator + 1).trim(),
      };
    });
}

function AboutForm({
  settings,
  onDone,
}: {
  settings: SiteSettings;
  onDone: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState({
    name: settings.name,
    handle: settings.handle,
    location: settings.location,
    aboutCopy: settings.aboutCopy,
    links: linksToText(settings.links),
  });
  const [status, setStatus] = useState<{ tone: string; message: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setStatus(null);

    try {
      const response = await fetch("/api/about", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          handle: draft.handle,
          location: draft.location,
          aboutCopy: draft.aboutCopy,
          links: textToLinks(draft.links),
        }),
      });

      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);

      setStatus({ tone: "ok", message: "Saved." });
      // The shell resolves settings server-side, so a refresh is what makes the
      // change visible without a redeploy.
      router.refresh();
      onDone();
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Could not save.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={save}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="about-name">
          Name
        </label>
        <input
          id="about-name"
          className={styles.input}
          value={draft.name}
          onChange={(event) =>
            setDraft((value) => ({ ...value, name: event.target.value }))
          }
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="about-handle">
          Handle
        </label>
        <input
          id="about-handle"
          className={styles.input}
          value={draft.handle}
          onChange={(event) =>
            setDraft((value) => ({ ...value, handle: event.target.value }))
          }
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="about-location">
          Location
        </label>
        <input
          id="about-location"
          className={styles.input}
          value={draft.location}
          onChange={(event) =>
            setDraft((value) => ({ ...value, location: event.target.value }))
          }
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="about-copy">
          Bio
        </label>
        <textarea
          id="about-copy"
          className={styles.textarea}
          value={draft.aboutCopy}
          onChange={(event) =>
            setDraft((value) => ({ ...value, aboutCopy: event.target.value }))
          }
        />
        <span className={styles.hint}>Blank lines separate paragraphs.</span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="about-links">
          Links
        </label>
        <textarea
          id="about-links"
          className={styles.textarea}
          value={draft.links}
          onChange={(event) =>
            setDraft((value) => ({ ...value, links: event.target.value }))
          }
        />
        <span className={styles.hint}>
          One per line, as <code>label|https://url</code>.
        </span>
      </div>

      <div className={styles.actions}>
        <GlassSurface
          as="button"
          tone="well"
          interactive
          className={styles.link}
          type="submit"
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </GlassSurface>
        <button type="button" className={styles.link} onClick={onDone}>
          Cancel
        </button>
        {status ? (
          <span className={styles.status} data-tone={status.tone}>
            {status.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
