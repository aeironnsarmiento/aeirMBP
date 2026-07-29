import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  clearedCookieOptions,
  isOwnerSecret,
  issueSessionToken,
  ownerSecretFault,
  sessionCookieOptions,
} from "@/lib/auth/session";
import {
  ownerSessionFault,
  rejectAsMissing,
  type OwnerFault,
} from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Owner authentication (R2, R3, R4, R7).
 *
 * Every verb is exported, including the four with no use here. Next binds an
 * unexported method to a canned 405 and an absent OPTIONS to a 204 carrying
 * `Allow`, both before handler code runs, so exporting all seven is the only
 * way to close the method surface. Only POST reads anything off the request —
 * a secret accepted from a query string would land in platform logs, browser
 * history and referrers permanently.
 */

const PATH = "/api/auth";

function reject(fault: OwnerFault): Response {
  return rejectAsMissing(fault, PATH);
}

function ok(owner: boolean): Response {
  return Response.json({ owner }, { headers: { "cache-control": "no-store" } });
}

/** Reports the owner session to a caller that already holds one. */
export async function GET() {
  const fault = await ownerSessionFault();
  return fault ? reject(fault) : ok(true);
}

/**
 * Signs the owner in. Judged on the secret alone — accepting a valid session
 * here would let a live cookie plus a garbage secret mint a fresh one (KTD6).
 */
export async function POST(request: Request) {
  // Before the body is read, so a broken deploy is named for whatever probe
  // arrives rather than reported as whatever that probe got wrong.
  const misconfigured = ownerSecretFault();
  if (misconfigured) return reject(misconfigured);

  let presented: unknown;
  try {
    presented = ((await request.json()) as { secret?: unknown } | null)?.secret;
  } catch {
    return reject("secret-invalid");
  }

  if (typeof presented !== "string" || !presented) {
    return reject("secret-invalid");
  }
  if (!isOwnerSecret(presented)) return reject("secret-mismatch");

  const store = await cookies();
  store.set(SESSION_COOKIE, await issueSessionToken(), sessionCookieOptions());

  return ok(true);
}

/** Signs the owner out. Gated on the session: an ungated verb confirms the
 *  route is handled (R3). */
export async function DELETE() {
  const fault = await ownerSessionFault();
  if (fault) return reject(fault);

  const store = await cookies();
  store.set(SESSION_COOKIE, "", clearedCookieOptions());

  return ok(false);
}

/* Verbs this route does not implement, exported so Next's 405 and its
 * `Allow`-bearing preflight never answer for them. */
const unsupported = () => reject("method-unsupported");
export const PUT = unsupported;
export const PATCH = unsupported;
export const HEAD = unsupported;
export const OPTIONS = unsupported;
