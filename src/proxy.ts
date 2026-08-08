import { NextResponse, type NextRequest } from "next/server";
import { rejectAsMissing, type OwnerFault } from "@/lib/auth/guard";
import {
  SESSION_COOKIE,
  ownerSecretFault,
  verifySessionToken,
} from "@/lib/auth/session";

export async function proxy(request: NextRequest) {
  const fault = await sessionFault(request);
  if (!fault) return NextResponse.next();

  return rejectAsMissing(fault, request.nextUrl.pathname);
}

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
    "/api/music/backfill/:path*",
    "/api/music/enrich/:path*",
  ],
};
