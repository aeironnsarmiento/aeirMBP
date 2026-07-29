/**
 * Owner sessions.
 *
 * One owner, one secret, one cookie (KTD9). There is no user table, no
 * password hash, and no identity provider — OWNER_SECRET is both the
 * credential presented at sign-in and the key the session cookie is signed
 * with, so a leaked cookie and a leaked secret have the same blast radius and
 * rotating the secret invalidates every issued session.
 *
 * Built on Web Crypto rather than node:crypto so the identical code runs in
 * middleware on the Edge runtime and in Node route handlers.
 */

export const SESSION_COOKIE = "xen_owner";

/** Seven days. Long enough to be usable, short enough that a stale cookie dies. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const TOKEN_VERSION = "v1";

export type SessionVerdict =
  | { valid: true; expiresAt: number }
  | { valid: false; reason: "malformed" | "expired" | "bad-signature" };

/** Below this, HMAC keying is weak enough that the secret is not one. */
export const MIN_OWNER_SECRET_LENGTH = 16;

/** Asked before touching a credential, so a broken deploy is named in the log
 *  rather than inferred from whatever probe happened to arrive. */
export function ownerSecretFault(): "secret-unset" | "secret-too-short" | null {
  const secret = process.env.OWNER_SECRET;
  if (!secret) return "secret-unset";
  return secret.length < MIN_OWNER_SECRET_LENGTH ? "secret-too-short" : null;
}

function ownerSecret(): string {
  const secret = process.env.OWNER_SECRET;
  if (!secret || secret.length < MIN_OWNER_SECRET_LENGTH) {
    throw new Error(
      `OWNER_SECRET is missing or shorter than ${MIN_OWNER_SECRET_LENGTH} characters. Owner auth cannot operate.`,
    );
  }
  return secret;
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/**
 * Length-independent, content constant-time comparison.
 *
 * Comparing with `===` leaks how many leading characters matched, which is
 * enough to forge a signature one byte at a time given enough attempts.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    mismatch |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return mismatch === 0;
}

/** True when the presented secret matches OWNER_SECRET. */
export function isOwnerSecret(presented: unknown): boolean {
  if (typeof presented !== "string" || presented.length === 0) return false;
  return timingSafeEqual(presented, ownerSecret());
}

/** Mints a signed token that expires `SESSION_TTL_SECONDS` from now. */
export async function issueSessionToken(now = Date.now()): Promise<string> {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `${TOKEN_VERSION}.${expiresAt}`;
  return `${payload}.${await sign(payload, ownerSecret())}`;
}

/**
 * Verifies a token's signature and expiry.
 *
 * Signature is checked before expiry so a tampered expiry cannot be probed by
 * the difference between the two rejection reasons.
 */
export async function verifySessionToken(
  token: string | undefined | null,
  now = Date.now(),
): Promise<SessionVerdict> {
  if (!token) return { valid: false, reason: "malformed" };

  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed" };

  const [version, expiryText, signature] = parts;
  if (version !== TOKEN_VERSION) return { valid: false, reason: "malformed" };

  const expiresAt = Number(expiryText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    return { valid: false, reason: "malformed" };
  }

  const expected = await sign(`${version}.${expiryText}`, ownerSecret());
  if (!timingSafeEqual(signature, expected)) {
    return { valid: false, reason: "bad-signature" };
  }

  if (expiresAt * 1000 <= now) return { valid: false, reason: "expired" };

  return { valid: true, expiresAt };
}

/** Cookie attributes for the issued session. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    // Not readable by script, and never sent over plain HTTP in production.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function clearedCookieOptions() {
  return { ...sessionCookieOptions(), maxAge: 0 };
}
