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

const PATH = "/api/auth";

function reject(fault: OwnerFault): Response {
  return rejectAsMissing(fault, PATH);
}

function ok(owner: boolean): Response {
  return Response.json({ owner }, { headers: { "cache-control": "no-store" } });
}

export async function GET() {
  const fault = await ownerSessionFault();
  return fault ? reject(fault) : ok(true);
}

export async function POST(request: Request) {
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

export async function DELETE() {
  const fault = await ownerSessionFault();
  if (fault) return reject(fault);

  const store = await cookies();
  store.set(SESSION_COOKIE, "", clearedCookieOptions());

  return ok(false);
}

const unsupported = () => reject("method-unsupported");
export const PUT = unsupported;
export const PATCH = unsupported;
export const HEAD = unsupported;
export const OPTIONS = unsupported;
