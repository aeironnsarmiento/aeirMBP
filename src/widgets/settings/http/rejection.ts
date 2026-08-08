export async function failureMessage(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`;

  if (response.status === 404) {
    return "Refused (404). The session may have expired, or the deploy's owner secret may be missing or too short — the server log names which.";
  }

  try {
    const body = (await response.json()) as { error?: unknown } | null;
    return typeof body?.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}
