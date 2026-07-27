/**
 * Rewrites a remote cover-art URL to the smallest variant that still looks
 * sharp at the size it is actually rendered.
 *
 * Every art provider this site reads encodes the variant in the URL, so asking
 * for a smaller one costs a string replacement and no request. Without it the
 * shell downloads what the provider happens to return first — which for Deezer
 * is `cover_xl`, a 1000x1000 JPEG at roughly 220KB, for a tile drawn 28px
 * wide. Six of those is most of a megabyte spent on pixels no one can see.
 *
 * Lives in `lib/` rather than the music widget because the shell's now-playing
 * pill renders cover art too, and the shell may not import from a widget.
 */

/**
 * Assumed device pixel ratio.
 *
 * Fixed at 2 rather than read from `window`: this runs during server render,
 * and a URL that changed after hydration would discard the image the browser
 * had already started fetching. 2 is sharp on retina and merely generous on a
 * 1x display, where the file is small enough that the waste does not matter.
 */
const DPR = 2;

/** Ladders are the provider's own published sizes — an off-ladder request is a cache miss. */
const DEEZER_SIZES = [56, 250, 500, 1000];
const LASTFM_SIZES = [34, 64, 174, 300];
const COVER_ART_ARCHIVE_SIZES = [250, 500, 1200];

/** Smallest rung that still covers the requested pixels; the largest if none does. */
function snapUp(sizes: readonly number[], needed: number): number {
  return sizes.find((size) => size >= needed) ?? sizes[sizes.length - 1];
}

/**
 * @param src   the provider URL as stored
 * @param cssPx the width the image is rendered at, in CSS pixels
 */
export function sizedImageUrl(src: string, cssPx: number): string {
  if (!src || cssPx <= 0) return src;
  const needed = Math.ceil(cssPx * DPR);

  // Deezer: /images/cover/<hash>/1000x1000-000000-80-0-0.jpg
  // The trailing parameters are quality and background and are left alone.
  const deezer = src.match(
    /^(https:\/\/(?:e-)?cdn-images\.dzcdn\.net\/images\/[a-z]+\/[a-f0-9]+\/)(\d+)x(\d+)(-.*)$/,
  );
  if (deezer) {
    const size = snapUp(DEEZER_SIZES, needed);
    return `${deezer[1]}${size}x${size}${deezer[4]}`;
  }

  // Last.fm: /i/u/300x300/<hash>.jpg, and the square `<n>s` form.
  const lastfm = src.match(
    /^(https:\/\/lastfm\.freetls\.fastly\.net\/i\/u\/)(?:\d+x\d+|\d+s)\/(.+)$/,
  );
  if (lastfm) {
    const size = snapUp(LASTFM_SIZES, needed);
    // 300 is published as `300x300`; the smaller rungs use the `s` suffix.
    return `${lastfm[1]}${size === 300 ? "300x300" : `${size}s`}/${lastfm[2]}`;
  }

  // Cover Art Archive: /release/<mbid>/front, optionally already suffixed.
  const archive = src.match(
    /^(https:\/\/coverartarchive\.org\/release\/[a-f0-9-]+\/front)(?:-\d+)?(\.\w+)?$/,
  );
  if (archive) {
    const size = snapUp(COVER_ART_ARCHIVE_SIZES, needed);
    return `${archive[1]}-${size}${archive[2] ?? ""}`;
  }

  // An unrecognised host keeps its URL. Guessing a variant scheme would break
  // the image outright, which is worse than serving one that is too large.
  return src;
}
