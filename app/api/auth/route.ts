import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  clearedCookieOptions,
  isOwnerSecret,
  issueSessionToken,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { isOwnerRequest } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports whether the caller currently holds an owner session. */
export async function GET() {
  return Response.json(
    { owner: await isOwnerRequest() },
    { headers: { "cache-control": "no-store" } },
  );
}

/** Signs the owner in by presenting the single owner secret. */
export async function POST(request: Request) {
  let secret: unknown;
  try {
    const body: unknown = await request.json();
    secret = (body as { secret?: unknown } | null)?.secret;
  } catch {
    return Response.json({ error: "invalid-body" }, { status: 400 });
  }

  if (!isOwnerSecret(secret)) {
    // Same shape and status as any other failure — no signal about whether the
    // secret was absent, malformed, or merely wrong.
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, await issueSessionToken(), sessionCookieOptions());

  return Response.json(
    { owner: true },
    { headers: { "cache-control": "no-store" } },
  );
}

/** Signs the owner out. */
export async function DELETE() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", clearedCookieOptions());
  return Response.json(
    { owner: false },
    { headers: { "cache-control": "no-store" } },
  );
}
