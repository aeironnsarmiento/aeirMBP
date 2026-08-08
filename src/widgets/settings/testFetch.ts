import { vi } from "vitest";
import { DEFAULT_SITE_SETTINGS } from "@/lib/site/schema";

export type SentRequest = { url: string; method: string; body: unknown };

type FetchOverride = (
  request: SentRequest,
  input: RequestInfo | URL,
  init?: RequestInit,
) => Response | Promise<Response>;

export const sentRequests: SentRequest[] = [];

export function resetSentRequests(): void {
  sentRequests.length = 0;
}

export function stubSettingsFetch(
  overrides: Record<string, FetchOverride> = {},
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const request = {
        url,
        method,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      };
      sentRequests.push(request);

      const key = `${method} ${url.split("?")[0]}`;
      if (overrides[key]) return overrides[key](request, input, init);

      if (key === "GET /api/settings") {
        return Response.json({ settings: DEFAULT_SITE_SETTINGS, backfill: null });
      }
      if (key === "GET /api/music/enrich") {
        return Response.json({ tracks: 0, artists: 0 });
      }
      return Response.json({});
    }),
  );
}
