/**
 * Turns a failed response into something the owner can act on (R7) — the
 * compensating control for the uniform rejection. Owner-only routes refuse
 * with a bare 404, so reading the body first throws a JSON syntax error and
 * buries the status. Call only after `response.ok` is false.
 *
 * Here rather than in either widget, because both need it and no widget may
 * import another.
 */
export async function failureMessage(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`;

  if (response.status === 404) {
    // A 404 from a route the panel knows exists is a refusal, not a miss.
    return "Refused (404). The session may have expired, or the deploy's owner secret may be missing or too short — the server log names which.";
  }

  try {
    const body = (await response.json()) as { error?: unknown } | null;
    return typeof body?.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}
