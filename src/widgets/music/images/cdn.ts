const DPR = 2;

const DEEZER_SIZES = [56, 250, 500, 1000];
const LASTFM_SIZES = [34, 64, 174, 300];
const COVER_ART_ARCHIVE_SIZES = [500, 1200];

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

  const deezer = src.match(
    /^(https:\/\/(?:e-)?cdn-images\.dzcdn\.net\/images\/[a-z]+\/[a-f0-9]+\/)(\d+)x(\d+)(-.*)$/,
  );
  if (deezer) {
    const size = snapUp(DEEZER_SIZES, needed);
    return `${deezer[1]}${size}x${size}${deezer[4]}`;
  }

  const lastfm = src.match(
    /^(https:\/\/lastfm\.freetls\.fastly\.net\/i\/u\/)(?:\d+x\d+|\d+s)\/(.+)$/,
  );
  if (lastfm) {
    const size = snapUp(LASTFM_SIZES, needed);
    return `${lastfm[1]}${size === 300 ? "300x300" : `${size}s`}/${lastfm[2]}`;
  }

  const archive = src.match(
    /^(https:\/\/coverartarchive\.org\/release\/[a-f0-9-]+\/front)(?:-\d+)?(\.\w+)?$/,
  );
  if (archive) {
    const size = snapUp(COVER_ART_ARCHIVE_SIZES, needed);
    return `${archive[1]}-${size}${archive[2] ?? ""}`;
  }

  return src;
}
