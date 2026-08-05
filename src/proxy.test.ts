// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE, issueSessionToken } from "@/lib/auth/session";
import { proxy } from "./proxy";

// The handler tests call handlers, so nothing else in the suite executes this
// function — without this file the unit that rewrote it verifies itself.

const SECRET = "owner-secret-long-enough-to-pass";

let warn: ReturnType<typeof vi.spyOn>;

function request(cookie?: string, path = "/api/settings") {
  return new NextRequest(`https://example.test${path}`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}

beforeAll(() => {
  process.env.OWNER_SECRET = SECRET;
});

afterAll(() => {
  delete process.env.OWNER_SECRET;
});

beforeEach(() => {
  process.env.OWNER_SECRET = SECRET;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("refusing an owner-only path (AE5)", () => {
  it("answers a bare 404 rather than a 401 with an error body", async () => {
    const response = await proxy(request());

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers.get("allow")).toBeNull();
  });

  it("answers a tampered cookie the same way as no cookie at all", async () => {
    const token = await issueSessionToken();
    const tampered = await proxy(
      request(`${SESSION_COOKIE}=${token.slice(0, -1)}x`),
    );
    const absent = await proxy(request());

    expect(tampered.status).toBe(404);
    expect(await tampered.text()).toBe("");
    expect([...tampered.headers.entries()].sort()).toEqual(
      [...absent.headers.entries()].sort(),
    );
  });

  it("answers every covered path identically", async () => {
    const prints = await Promise.all(
      ["/api/settings", "/api/music/backfill", "/api/music/enrich"].map(
        async (path) => {
          const response = await proxy(request(undefined, path));
          return { status: response.status, body: await response.text() };
        },
      ),
    );

    for (const print of prints) expect(print).toEqual(prints[0]);
    expect(prints[0].status).toBe(404);
  });
});

describe("a misconfigured deploy (AE6)", () => {
  it("answers 404 rather than a 500 when a well-formed cookie meets an unset secret", async () => {
    const token = await issueSessionToken();
    delete process.env.OWNER_SECRET;

    const response = await proxy(request(`${SESSION_COOKIE}=${token}`));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("answers 404 rather than a 500 when the secret is under-length", async () => {
    const token = await issueSessionToken();
    process.env.OWNER_SECRET = "short";

    expect((await proxy(request(`${SESSION_COOKIE}=${token}`))).status).toBe(404);
  });

  it("names the configuration fault in the log, not in the response", async () => {
    delete process.env.OWNER_SECRET;

    const response = await proxy(request());

    expect(await response.text()).toBe("");
    expect(String(warn.mock.calls[0][0])).toContain("secret-unset");
    expect(String(warn.mock.calls[0][0])).toContain("/api/settings");
  });

  it("never writes the configured secret to the log", async () => {
    await proxy(request(`${SESSION_COOKIE}=nonsense`));

    for (const call of warn.mock.calls) {
      expect(String(call[0])).not.toContain(SECRET);
    }
  });
});

describe("admitting the owner", () => {
  it("lets a valid session through untouched", async () => {
    const response = await proxy(
      request(`${SESSION_COOKIE}=${await issueSessionToken()}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
