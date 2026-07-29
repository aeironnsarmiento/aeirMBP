import { NextResponse, type NextRequest } from "next/server";
import { rejectAsMissing, type OwnerFault } from "@/lib/auth/guard";
import {
  SESSION_COOKIE,
  ownerSecretFault,
  verifySessionToken,
} from "@/lib/auth/session";

/**
 * Blanket guard over every owner-only API path, so an unauthenticated mutation
 * never reaches handler code or opens a database connection. Handlers call
 * `requireOwner()` too, so a route added without a matcher entry still fails
 * closed (R34). Both layers answer with the same bare 404 (R2).
 *
 * Next 16 renamed the `middleware.ts` convention to `proxy.ts` and fails the
 * build when both exist.
 */
export async function proxy(request: NextRequest) {
  const fault = await sessionFault(request);
  if (!fault) return NextResponse.next();

  return rejectAsMissing(fault, request.nextUrl.pathname);
}

/** Never throws: without this a misconfigured deploy 500s here, before any
 *  route handler's own wrapping gets a say (AE6). */
async function sessionFault(request: NextRequest): Promise<OwnerFault | null> {
  const misconfigured = ownerSecretFault();
  if (misconfigured) return misconfigured;

  try {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    return (await verifySessionToken(token)).valid ? null : "no-session";
  } catch {
    return "session-unreadable";
  }
}

export const config = {
  matcher: [
    "/api/settings/:path*",
    "/api/about/:path*",
    "/api/music/backfill/:path*",
    "/api/music/enrich/:path*",
  ],
};
