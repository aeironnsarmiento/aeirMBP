import { describe, expect, it } from "vitest";
import { sizedImageUrl } from "../cdn";

const DEEZER_XL =
  "https://cdn-images.dzcdn.net/images/cover/cdb946798ede9b11de8831a9e4b2f894/1000x1000-000000-80-0-0.jpg";
const LASTFM_300 =
  "https://lastfm.freetls.fastly.net/i/u/300x300/a967a1bf8d3e2efc2ae4047454fdb64b.jpg";
const ARCHIVE = "https://coverartarchive.org/release/1a2b3c4d-0000-1111-2222-333344445555/front";

describe("Deezer", () => {
  it("drops a 1000px cover to the 56px rung for a 28px tile", () => {
    // 28 CSS px at DPR 2 needs 56 real pixels — the smallest rung Deezer publishes.
    expect(sizedImageUrl(DEEZER_XL, 28)).toBe(
      "https://cdn-images.dzcdn.net/images/cover/cdb946798ede9b11de8831a9e4b2f894/56x56-000000-80-0-0.jpg",
    );
  });

  it("takes the next rung up rather than a rung that would blur", () => {
    // 44 CSS px needs 88 real pixels: 56 is too small, so 250 it is.
    expect(sizedImageUrl(DEEZER_XL, 44)).toContain("/250x250-");
  });

  it("keeps the quality parameters the URL already carried", () => {
    expect(sizedImageUrl(DEEZER_XL, 28)).toMatch(/-000000-80-0-0\.jpg$/);
  });

  it("handles the e-cdn host alias", () => {
    const alias = DEEZER_XL.replace("cdn-images", "e-cdn-images");
    expect(sizedImageUrl(alias, 28)).toContain("/56x56-");
  });

  it("never upscales past the largest published rung", () => {
    expect(sizedImageUrl(DEEZER_XL, 4000)).toContain("/1000x1000-");
  });
});

describe("Last.fm", () => {
  it("uses the s-suffixed rung below 300", () => {
    expect(sizedImageUrl(LASTFM_300, 28)).toBe(
      "https://lastfm.freetls.fastly.net/i/u/64s/a967a1bf8d3e2efc2ae4047454fdb64b.jpg",
    );
  });

  it("spells the largest rung as 300x300, which is the only form Last.fm serves", () => {
    expect(sizedImageUrl(LASTFM_300, 300)).toContain("/300x300/");
  });

  it("re-sizes a URL that already carries an s-suffixed rung", () => {
    const small = LASTFM_300.replace("300x300", "34s");
    expect(sizedImageUrl(small, 44)).toContain("/174s/");
  });
});

describe("Cover Art Archive", () => {
  it("appends the size suffix", () => {
    expect(sizedImageUrl(ARCHIVE, 44)).toBe(`${ARCHIVE}-500`);
  });

  it("replaces a suffix that is already there rather than stacking one", () => {
    expect(sizedImageUrl(`${ARCHIVE}-1200`, 44)).toBe(`${ARCHIVE}-500`);
  });

  // MusicBrainz HEAD-verifies front-500 and stores exactly that. Snapping to a
  // smaller rung asks for a derivative nobody checked, and a 404 there is
  // indistinguishable from an unenriched track: a silent initials tile.
  it("leaves a stored front-500 untouched at every size the app renders", () => {
    const stored = `${ARCHIVE}-500`;
    expect(sizedImageUrl(stored, 28)).toBe(stored);
    expect(sizedImageUrl(stored, 44)).toBe(stored);
  });
});

describe("anything else", () => {
  it("passes an unrecognised host through untouched", () => {
    // Guessing a variant scheme would 404 the image, which is worse than a big one.
    const other = "https://example.com/art/cover.jpg";
    expect(sizedImageUrl(other, 28)).toBe(other);
  });

  it("passes through an empty source", () => {
    expect(sizedImageUrl("", 28)).toBe("");
  });

  it("passes through a non-positive size rather than dividing by it", () => {
    expect(sizedImageUrl(DEEZER_XL, 0)).toBe(DEEZER_XL);
  });
});
