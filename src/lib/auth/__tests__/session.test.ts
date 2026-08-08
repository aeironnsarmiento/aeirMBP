// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SESSION_TTL_SECONDS,
  isOwnerSecret,
  issueSessionToken,
  sessionCookieOptions,
  timingSafeEqual,
  verifySessionToken,
} from "../session";

const SECRET = "correct-horse-battery-staple-32ch";

beforeEach(() => {
  process.env.OWNER_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.OWNER_SECRET;
});

describe("presenting the owner secret", () => {
  it("does not accept an incorrect secret", () => {
    expect(isOwnerSecret("wrong")).toBe(false);
    expect(isOwnerSecret(`${SECRET} `)).toBe(false);
    expect(isOwnerSecret(SECRET.slice(0, -1))).toBe(false);
  });

  it("does not accept an absent or non-string secret", () => {
    expect(isOwnerSecret(undefined)).toBe(false);
    expect(isOwnerSecret(null)).toBe(false);
    expect(isOwnerSecret("")).toBe(false);
    expect(isOwnerSecret(123)).toBe(false);
    expect(isOwnerSecret({ secret: SECRET })).toBe(false);
  });

  it("accepts the configured secret", () => {
    expect(isOwnerSecret(SECRET)).toBe(true);
  });

  it("refuses to operate when OWNER_SECRET is unset or too short", () => {
    delete process.env.OWNER_SECRET;
    expect(() => isOwnerSecret(SECRET)).toThrow(/OWNER_SECRET/);

    process.env.OWNER_SECRET = "short";
    expect(() => isOwnerSecret("short")).toThrow(/OWNER_SECRET/);
  });

  it("compares in constant time regardless of where the mismatch falls", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "xbc")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("session tokens", () => {
  it("accepts a token it just issued (AE2 inverse)", async () => {
    const verdict = await verifySessionToken(await issueSessionToken());

    expect(verdict.valid).toBe(true);
  });

  it("rejects a missing cookie", async () => {
    expect(await verifySessionToken(undefined)).toEqual({
      valid: false,
      reason: "malformed",
    });
    expect(await verifySessionToken("")).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("rejects a malformed token", async () => {
    for (const token of ["nonsense", "v1.123", "v1.123.sig.extra", "v2.123.sig"]) {
      const verdict = await verifySessionToken(token);
      expect(verdict.valid).toBe(false);
    }
  });

  it("rejects a token whose signature was tampered with", async () => {
    const token = await issueSessionToken();
    const [version, expiry, signature] = token.split(".");
    const tampered = `${version}.${expiry}.${signature.slice(0, -1)}${
      signature.endsWith("A") ? "B" : "A"
    }`;

    expect(await verifySessionToken(tampered)).toEqual({
      valid: false,
      reason: "bad-signature",
    });
  });

  it("rejects a token whose expiry was extended", async () => {
    const token = await issueSessionToken();
    const [version, expiry, signature] = token.split(".");
    const extended = `${version}.${Number(expiry) + 10_000}.${signature}`;

    expect(await verifySessionToken(extended)).toEqual({
      valid: false,
      reason: "bad-signature",
    });
  });

  it("rejects an expired token even though its signature is intact", async () => {
    const issuedAt = Date.now();
    const token = await issueSessionToken(issuedAt);
    const afterExpiry = issuedAt + (SESSION_TTL_SECONDS + 1) * 1000;

    expect(await verifySessionToken(token, afterExpiry)).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("rejects a token signed with a different owner secret", async () => {
    const token = await issueSessionToken();

    process.env.OWNER_SECRET = "a-completely-different-owner-secret";

    expect(await verifySessionToken(token)).toEqual({
      valid: false,
      reason: "bad-signature",
    });
  });
});

describe("cookie attributes", () => {
  it("is httpOnly, same-site, and root-scoped", () => {
    const options = sessionCookieOptions();

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
    expect(options.maxAge).toBe(SESSION_TTL_SECONDS);
  });

  it("is secure in production", () => {
    const previous = process.env.NODE_ENV;
    // NODE_ENV is readonly in the Next type surface; the runtime value is what matters.
    (process.env as Record<string, string>).NODE_ENV = "production";

    expect(sessionCookieOptions().secure).toBe(true);

    (process.env as Record<string, string>).NODE_ENV = previous ?? "test";
  });
});
