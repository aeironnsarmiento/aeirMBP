import { cookies } from "next/headers";
import { SESSION_COOKIE, ownerSecretFault, verifySessionToken } from "./session";

/**
 * Whether the current request carries a valid owner session.
 *
 * Used by server components to decide registry visibility (R16) and by
 * mutation handlers to decide whether to proceed (R34). It never throws on a
 * missing or malformed cookie — an absent session is a normal visitor.
 */
export async function isOwnerRequest(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const verdict = await verifySessionToken(token);
  return verdict.valid;
}

/** Cron's rejection. Owner-only paths use `rejectAsMissing()`; don't merge
 *  the two — editing this turns cron denials into 404s (KTD5). */
export function unauthorized(): Response {
  return Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

/** Logged, never returned (KTD7). With no sign-in form left, this is the
 *  owner's only channel for telling one failure from another. */
export type OwnerFault =
  | "secret-unset"
  | "secret-too-short"
  | "secret-invalid"
  | "secret-mismatch"
  | "no-session"
  | "session-unreadable"
  | "method-unsupported";

/** The one rejection every owner-only path returns (R2, R3): bare 404, no
 *  body, no `Allow`. `no-store` stops a proxy caching it back at the owner. */
export function rejectAsMissing(fault: OwnerFault, path?: string): Response {
  // Never log the presented value — it outlives the request that leaked it.
  console.warn(`owner-auth refused${path ? ` ${path}` : ""}: ${fault}`);

  return new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

/** Never throws: the secret lookup raises on a missing or short value, and a
 *  well-formed cookie reaches it, so a broken deploy would 500 (AE6). */
export async function ownerSessionFault(): Promise<OwnerFault | null> {
  const misconfigured = ownerSecretFault();
  if (misconfigured) return misconfigured;

  try {
    return (await isOwnerRequest()) ? null : "no-session";
  } catch {
    return "session-unreadable";
  }
}

/**
 * Returns a 404 to return directly, or null for the owner. Called even though
 * the proxy covers the same paths, so a route added without a matcher entry
 * still fails closed — but a 404 no longer proves a guard ran, so only a test
 * proves a new route is covered.
 */
export async function requireOwner(): Promise<Response | null> {
  const fault = await ownerSessionFault();
  return fault ? rejectAsMissing(fault) : null;
}

/**
 * Guards the scheduled poll route, which is invoked by Vercel Cron rather than
 * by the owner and therefore carries a shared secret instead of a session.
 */
export function requireCronSecret(request: Request): Response | null {
  const configured = process.env.CRON_SECRET;
  if (!configured) {
    return Response.json(
      { error: "cron-secret-not-configured" },
      { status: 500 },
    );
  }

  const presented = request.headers.get("authorization");
  const expected = `Bearer ${configured}`;
  if (!presented || presented.length !== expected.length) return unauthorized();

  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0 ? null : unauthorized();
}
