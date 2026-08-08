import { describe, expect, it } from "vitest";
import {
  ASSET_RULES,
  UploadRejected,
  baseMimeType,
  formatMegabytes,
  validateAsset,
} from "../schema";

describe("asset ceilings (R12, R16, R17)", () => {
  it("holds the avatar to 3MB", () => {
    expect(ASSET_RULES.avatar.maxBytes).toBe(3 * 1024 * 1024);
  });

  it("holds a background to 10MB", () => {
    expect(ASSET_RULES.background.maxBytes).toBe(10 * 1024 * 1024);
  });

  it("accepts a file one byte under the kind's ceiling", () => {
    for (const kind of ["avatar", "background"] as const) {
      expect(() =>
        validateAsset(kind, {
          type: "image/png",
          size: ASSET_RULES[kind].maxBytes - 1,
        }),
      ).not.toThrow();
    }
  });

  it("rejects a file one byte over the kind's ceiling", () => {
    for (const kind of ["avatar", "background"] as const) {
      expect(() =>
        validateAsset(kind, {
          type: "image/png",
          size: ASSET_RULES[kind].maxBytes + 1,
        }),
      ).toThrow(UploadRejected);
    }
  });

  it("applies each kind's own ceiling, not a shared one", () => {
    const betweenTheTwo = ASSET_RULES.avatar.maxBytes + 1;

    expect(() =>
      validateAsset("avatar", { type: "image/png", size: betweenTheTwo }),
    ).toThrow(UploadRejected);
    expect(() =>
      validateAsset("background", { type: "image/png", size: betweenTheTwo }),
    ).not.toThrow();
  });

  it("states both the file's size and the ceiling when it refuses (R16)", () => {
    expect(() =>
      validateAsset("avatar", { type: "image/png", size: 5 * 1024 * 1024 }),
    ).toThrow(/File is 5MB; the limit is 3MB\./);
  });

  it("renders whole and fractional sizes the way the copy states them", () => {
    expect(formatMegabytes(3 * 1024 * 1024)).toBe("3MB");
    expect(formatMegabytes(10 * 1024 * 1024)).toBe("10MB");
    expect(formatMegabytes(1.5 * 1024 * 1024)).toBe("1.5MB");
  });
});

describe("accepted types (R10)", () => {
  it("accepts an animated GIF for both kinds", () => {
    for (const kind of ["avatar", "background"] as const) {
      expect(() =>
        validateAsset(kind, { type: "image/gif", size: 1_000 }),
      ).not.toThrow();
    }
  });

  it("rejects a non-image, naming the type, ahead of any size check", () => {
    for (const type of ["application/pdf", "text/html", "application/zip"]) {
      expect(() =>
        // Over every ceiling as well, so the type must be what is reported.
        validateAsset("avatar", { type, size: 500 * 1024 * 1024 }),
      ).toThrow(new RegExp(`Unsupported file type: ${type}`));
    }
  });

  it("names an absent type rather than reporting an empty string", () => {
    expect(() => validateAsset("avatar", { type: "", size: 1_000 })).toThrow(
      /Unsupported file type: unknown/,
    );
  });

  it("rejects a zero-byte file", () => {
    expect(() =>
      validateAsset("background", { type: "image/png", size: 0 }),
    ).toThrow(/File is empty\./);
  });
});

describe("re-encoded backgrounds (the transcoder's own output)", () => {
  const ONE_MB = 1024 * 1024;

  it("accepts a MIME type that carries codec parameters", () => {
    // What MediaRecorder actually reports. Matching the bare type against this
    // string rejected the transcoder's own output, so the feature failed the
    // moment it started working.
    expect(() =>
      validateAsset("background", {
        type: "video/webm;codecs=vp8",
        size: ONE_MB,
      }),
    ).not.toThrow();
  });

  it("accepts both containers the transcoder can emit", () => {
    for (const type of ["video/mp4", "video/webm"]) {
      expect(() =>
        validateAsset("background", { type, size: ONE_MB }),
      ).not.toThrow();
    }
  });

  it("accepts an H.264 profile string", () => {
    expect(() =>
      validateAsset("background", {
        type: "video/mp4;codecs=avc1.42E01E",
        size: ONE_MB,
      }),
    ).not.toThrow();
  });

  it("ignores case and spacing around the parameter", () => {
    expect(() =>
      validateAsset("background", {
        type: "VIDEO/WEBM ;codecs=vp9",
        size: ONE_MB,
      }),
    ).not.toThrow();
  });

  it("still refuses a video as an avatar", () => {
    // Only the background is re-encoded; the avatar stays an image.
    expect(() =>
      validateAsset("avatar", { type: "video/webm", size: ONE_MB }),
    ).toThrow(UploadRejected);
  });

  it("still refuses a type that is not on the list at all", () => {
    expect(() =>
      validateAsset("background", { type: "video/quicktime", size: ONE_MB }),
    ).toThrow(UploadRejected);
  });

  it("names what it accepts, rather than a hardcoded image list", () => {
    expect(() =>
      validateAsset("background", { type: "application/zip", size: ONE_MB }),
    ).toThrow(/MP4/);
  });
});

describe("baseMimeType", () => {
  it("drops parameters", () => {
    expect(baseMimeType("video/webm;codecs=vp8")).toBe("video/webm");
  });

  it("leaves a bare type alone", () => {
    expect(baseMimeType("image/png")).toBe("image/png");
  });

  it("normalises case and surrounding space", () => {
    expect(baseMimeType(" Image/PNG ")).toBe("image/png");
  });
});
