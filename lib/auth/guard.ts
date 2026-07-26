import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./session";

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

/**
 * The rejection every guarded mutation handler returns.
 *
 * Deliberately opaque: an unauthenticated caller learns that the route exists
 * and nothing else.
 */
export function unauthorized(): Response {
  return Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

/**
 * Guards a mutation handler.
 *
 * Returns a 401 Response to return directly, or null when the caller is the
 * owner. Handlers call this even though middleware also covers their path —
 * a route added later without a matcher entry must still fail closed.
 *
 *     const denied = await requireOwner();
 *     if (denied) return denied;
 */
export async function requireOwner(): Promise<Response | null> {
  return (await isOwnerRequest()) ? null : unauthorized();
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
