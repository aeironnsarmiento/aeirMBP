const KEY_SEPARATOR = String.fromCharCode(31);

const DASHES = /[‐‑‒–—―−]/g;
const APOSTROPHES = /[‘’ʼ′`]/g;
const QUOTES = /[“”″]/g;

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

function stripNoiseSuffixes(value: string): string {
  let result = value;

  for (let pass = 0; pass < 4; pass += 1) {
    const bracketed = result.match(/^(.*?)\s*[([]([^()[\]]*)[)\]]\s*$/);
    if (bracketed && isNoise(bracketed[2])) {
      result = collapse(bracketed[1]);
      continue;
    }

    const dashAt = result.lastIndexOf(" - ");
    if (dashAt > 0 && isNoise(result.slice(dashAt + 3))) {
      result = collapse(result.slice(0, dashAt));
      continue;
    }

    break;
  }

  return result;
}

export function normalizeArtist(raw: string): string {
  return collapse(foldPunctuation(raw).toLowerCase());
}

export function normalizeTitle(raw: string): string {
  const folded = collapse(foldPunctuation(raw).toLowerCase());
  const withoutFeature = collapse(
    folded.replace(FEATURING_BRACKETED, " "),
  ).replace(FEATURING_TRAILING, "");
  return collapse(stripNoiseSuffixes(collapse(withoutFeature)));
}


export function trackKey(artist: string, track: string): string {
  return `${normalizeArtist(artist)}${KEY_SEPARATOR}${normalizeTitle(track)}`;
}

export function albumKey(
  artist: string,
  album: string | null | undefined,
): string | null {
  if (!album) return null;
  const normalized = normalizeTitle(album);
  if (!normalized) return null;
  return `${normalizeArtist(artist)}${KEY_SEPARATOR}${normalized}`;
}
