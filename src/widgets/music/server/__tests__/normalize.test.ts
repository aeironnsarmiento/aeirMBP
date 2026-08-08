// @vitest-environment node
import { describe, expect, it } from "vitest";
import { albumKey, normalizeArtist, normalizeTitle, trackKey } from "../normalize";

describe("client spelling variance collapses to one key", () => {
  it("ignores casing", () => {
    expect(trackKey("Radiohead", "Weird Fishes")).toBe(
      trackKey("radiohead", "WEIRD FISHES"),
    );
  });

  it("ignores surrounding and repeated whitespace", () => {
    expect(trackKey("  Radiohead ", "Weird   Fishes")).toBe(
      trackKey("Radiohead", "Weird Fishes"),
    );
  });

  it("unifies dash characters", () => {
    expect(trackKey("Sigur Rós", "Hoppípolla – Live")).toBe(
      trackKey("Sigur Rós", "Hoppípolla - Live"),
    );
    expect(normalizeTitle("A—B")).toBe(normalizeTitle("A-B"));
  });

  it("unifies curly and straight apostrophes", () => {
    expect(trackKey("Guns N’ Roses", "Don’t Cry")).toBe(
      trackKey("Guns N' Roses", "Don't Cry"),
    );
  });
});

describe("release noise is stripped, recording differences are not", () => {
  const plain = trackKey("Nirvana", "Come As You Are");

  it("strips a bracketed remaster suffix", () => {
    expect(trackKey("Nirvana", "Come As You Are (2011 Remaster)")).toBe(plain);
    expect(trackKey("Nirvana", "Come As You Are [Remastered]")).toBe(plain);
  });

  it("strips a dash-suffixed remaster marker", () => {
    expect(trackKey("Nirvana", "Come As You Are - 2011 Remaster")).toBe(plain);
    expect(trackKey("Nirvana", "Come As You Are - Remastered 2011")).toBe(plain);
  });

  it("strips a hyphenated remaster spelling inside the suffix", () => {
    expect(trackKey("Nirvana", "Come As You Are - 2011 Re-Master")).toBe(plain);
  });

  it("strips stacked suffixes", () => {
    expect(
      trackKey("Nirvana", "Come As You Are - Remastered (Deluxe Edition)"),
    ).toBe(plain);
  });

  it("strips other release-level markers", () => {
    for (const suffix of [
      "(Album Version)",
      "(Bonus Track)",
      "(Explicit)",
      "(Deluxe Edition)",
      "(30th Anniversary Edition)",
    ]) {
      expect(trackKey("Nirvana", `Come As You Are ${suffix}`)).toBe(plain);
    }
  });

  it("keeps a different recording of the same song distinct", () => {
    for (const suffix of [
      "(Acoustic)",
      "(Live)",
      "(Demo)",
      "(Radio Edit)",
      "(Instrumental)",
      "- Live at Reading",
    ]) {
      expect(trackKey("Nirvana", `Come As You Are ${suffix}`)).not.toBe(plain);
    }
  });

  it("keeps two genuinely different tracks by one artist distinct", () => {
    expect(trackKey("Nirvana", "Come As You Are")).not.toBe(
      trackKey("Nirvana", "Lithium"),
    );
  });

  it("keeps the same title by different artists distinct", () => {
    expect(trackKey("Nirvana", "Something")).not.toBe(
      trackKey("The Beatles", "Something"),
    );
  });
});

describe("featuring credits", () => {
  const plain = trackKey("Kanye West", "Runaway");

  it("collapses bracketed featuring credits", () => {
    expect(trackKey("Kanye West", "Runaway (feat. Pusha T)")).toBe(plain);
    expect(trackKey("Kanye West", "Runaway [ft. Pusha T]")).toBe(plain);
    expect(trackKey("Kanye West", "Runaway (featuring Pusha T)")).toBe(plain);
  });

  it("collapses a trailing unbracketed featuring credit", () => {
    expect(trackKey("Kanye West", "Runaway feat. Pusha T")).toBe(plain);
    expect(trackKey("Kanye West", "Runaway ft Pusha T")).toBe(plain);
  });
});

describe("album keys", () => {
  it("is null when the scrobble carries no album", () => {
    expect(albumKey("Radiohead", null)).toBeNull();
    expect(albumKey("Radiohead", undefined)).toBeNull();
    expect(albumKey("Radiohead", "   ")).toBeNull();
  });

  it("scopes the album to its artist", () => {
    expect(albumKey("Radiohead", "In Rainbows")).not.toBe(
      albumKey("Someone Else", "In Rainbows"),
    );
  });

  it("collapses a deluxe reissue into the base album", () => {
    expect(albumKey("Radiohead", "In Rainbows (Deluxe Edition)")).toBe(
      albumKey("Radiohead", "In Rainbows"),
    );
  });
});

describe("key structure", () => {
  it("cannot be forged by a printable separator in a name", () => {
    expect(trackKey("a|b", "c")).not.toBe(trackKey("a", "b|c"));
    expect(trackKey("a-b", "c")).not.toBe(trackKey("a", "b-c"));
  });

  it("normalizes the artist half consistently", () => {
    expect(normalizeArtist("  Sigur   Rós ")).toBe("sigur rós");
  });
});
