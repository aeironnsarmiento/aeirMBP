/**
 * Track identity normalization (KTD10).
 *
 * Scrobbles carry whatever strings the submitting client sent, so the same
 * song arrives as "Song", "song", "Song - 2011 Remaster" and
 * "Song (feat. Someone)" across plays. Keying on the raw strings would enrich
 * the same track several times and split its plays across rows in top-tracks.
 *
 * These rules are lossy on purpose. Two genuinely different recordings that
 * normalize to the same key will merge — judged the lesser error against
 * splitting one song across several rows, but it is a bet, not a certainty.
 * Display always reads the raw strings; only grouping and enrichment read
 * these keys.
 */

/**
 * Separator between the artist and title halves of a key. ASCII unit
 * separator: no track or artist name can contain it, whereas a printable
 * separator would let a name that happens to contain it forge a collision.
 */
const KEY_SEPARATOR = String.fromCharCode(31);

const DASHES = /[‐‑‒–—―−]/g;
const APOSTROPHES = /[‘’ʼ′`]/g;
const QUOTES = /[“”″]/g;

/**
 * Bracketed or dash-suffixed segments that describe a release rather than a
 * song. Kept to an explicit list: stripping every trailing parenthetical would
 * collapse "Song (Acoustic)" into "Song", which are different recordings.
 */
const NOISE_SUFFIXES: readonly RegExp[] = [
  /^(\d{4}\s+)?(digital(ly)?\s+)?re-?master(ed)?(\s+version)?(\s+\d{4})?$/,
  /^re-?mastered?\s+\d{4}$/,
  /^\d{4}\s+(re-?issue|version|mix)$/,
  /^album\s+version$/,
  /^original\s+album\s+version$/,
  /^bonus\s+track$/,
  /^deluxe(\s+(edition|version))?$/,
  /^expanded(\s+edition)?$/,
  /^(\d+(st|nd|rd|th)\s+)?anniversary(\s+edition)?$/,
  /^explicit(\s+version)?$/,
  /^clean(\s+version)?$/,
  /^single(\s+version)?$/,
];

/** Featuring credits, which vary independently of the recording. */
const FEATURING_BRACKETED =
  /\s*[([]\s*(feat|ft|featuring|with)\b[^)\]]*[)\]]\s*/gi;
const FEATURING_TRAILING = /\s+(feat|ft|featuring)\.?\s+.+$/i;

function foldPunctuation(value: string): string {
  return value
    .replace(DASHES, "-")
    .replace(APOSTROPHES, "'")
    .replace(QUOTES, '"');
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isNoise(segment: string): boolean {
  return NOISE_SUFFIXES.some((pattern) => pattern.test(collapse(segment)));
}

/**
 * Removes trailing release noise, whether bracketed — "song (2011 remaster)" —
 * or dash-suffixed — "song - 2011 remaster". Repeats so stacked suffixes such
 * as "song - remastered (deluxe edition)" reduce fully.
 *
 * Expects already-folded, already-lowercased input.
 */
function stripNoiseSuffixes(value: string): string {
  let result = value;

  for (let pass = 0; pass < 4; pass += 1) {
    const bracketed = result.match(/^(.*?)\s*[([]([^()[\]]*)[)\]]\s*$/);
    if (bracketed && isNoise(bracketed[2])) {
      result = collapse(bracketed[1]);
      continue;
    }

    // lastIndexOf rather than a regex so a hyphen inside the suffix itself
    // ("song - 2011 re-master") does not defeat the match.
    const dashAt = result.lastIndexOf(" - ");
    if (dashAt > 0 && isNoise(result.slice(dashAt + 3))) {
      result = collapse(result.slice(0, dashAt));
      continue;
    }

    break;
  }

  return result;
}

/** Normalized artist identity. Used to group top artists. */
export function normalizeArtist(raw: string): string {
  return collapse(foldPunctuation(raw).toLowerCase());
}

/** Normalized title, with featuring credits and release noise removed. */
export function normalizeTitle(raw: string): string {
  const folded = collapse(foldPunctuation(raw).toLowerCase());
  const withoutFeature = collapse(
    folded.replace(FEATURING_BRACKETED, " "),
  ).replace(FEATURING_TRAILING, "");
  return collapse(stripNoiseSuffixes(collapse(withoutFeature)));
}

/**
 * The identity two plays of the same song share.
 *
 * Artist is part of the key: two different artists can and do release songs
 * with the same title.
 */
export function trackKey(artist: string, track: string): string {
  return `${normalizeArtist(artist)}${KEY_SEPARATOR}${normalizeTitle(track)}`;
}

/** The identity used to group top albums. Null when the scrobble carries no album. */
export function albumKey(
  artist: string,
  album: string | null | undefined,
): string | null {
  if (!album) return null;
  const normalized = normalizeTitle(album);
  if (!normalized) return null;
  return `${normalizeArtist(artist)}${KEY_SEPARATOR}${normalized}`;
}
