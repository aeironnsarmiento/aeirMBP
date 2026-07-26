import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/**
 * Blanket guard over every owner-only API path.
 *
 * The plan calls this `middleware.ts`; Next 16 renamed the convention to
 * `proxy.ts` and fails the build when both files exist. Same request
 * interception, same matcher semantics.
 *
 * This is the outer layer, not the only one: each handler calls requireOwner()
 * as well, so a route added later without a matcher entry still fails closed
 * (R34). The proxy exists so an unauthenticated mutation never reaches handler
 * code or opens a database connection.
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const verdict = await verifySessionToken(token);

  if (verdict.valid) return NextResponse.next();

  return NextResponse.json(
    { error: "unauthorized" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export const config = {
  matcher: [
    "/api/settings/:path*",
    "/api/about/:path*",
    "/api/music/backfill/:path*",
    "/api/music/enrich/:path*",
  ],
};
