import { cookies } from "next/headers";
import { SESSION_COOKIE, ownerSecretFault, verifySessionToken } from "./session";

export async function isOwnerRequest(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const verdict = await verifySessionToken(token);
  return verdict.valid;
}

export function unauthorized(): Response {
  return Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export type OwnerFault =
  | "secret-unset"
  | "secret-too-short"
  | "secret-invalid"
  | "secret-mismatch"
  | "no-session"
  | "session-unreadable"
  | "method-unsupported";

export function rejectAsMissing(fault: OwnerFault, path?: string): Response {
  console.warn(`owner-auth refused${path ? ` ${path}` : ""}: ${fault}`);
  return new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

export async function ownerSessionFault(): Promise<OwnerFault | null> {
  const misconfigured = ownerSecretFault();
  if (misconfigured) return misconfigured;

  try {
    return (await isOwnerRequest()) ? null : "no-session";
  } catch {
    return "session-unreadable";
  }
}

export async function requireOwner(): Promise<Response | null> {
  const fault = await ownerSessionFault();
  return fault ? rejectAsMissing(fault) : null;
}

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
