export const SESSION_COOKIE = "xen_owner";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const TOKEN_VERSION = "v1";

export type SessionVerdict =
  | { valid: true; expiresAt: number }
  | { valid: false; reason: "malformed" | "expired" | "bad-signature" };

export const MIN_OWNER_SECRET_LENGTH = 16;

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

export function isOwnerSecret(presented: unknown): boolean {
  if (typeof presented !== "string" || presented.length === 0) return false;
  return timingSafeEqual(presented, ownerSecret());
}

export async function issueSessionToken(now = Date.now()): Promise<string> {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `${TOKEN_VERSION}.${expiresAt}`;
  return `${payload}.${await sign(payload, ownerSecret())}`;
}

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

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function clearedCookieOptions() {
  return { ...sessionCookieOptions(), maxAge: 0 };
}
