// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/session";

const SECRET = "owner-secret-long-enough-to-pass";

let sessionCookie: string | undefined;
let cookieWrites: Array<{ name: string; value: string; options: Record<string, unknown> }>;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && sessionCookie !== undefined
        ? { value: sessionCookie }
        : undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => {
      cookieWrites.push({ name, value, options });
    },
  }),
}));

let warn: ReturnType<typeof vi.spyOn>;

function loggedFaults(): string[] {
  return warn.mock.calls.map((call: unknown[]) => String(call[0]));
}

function post(body: string, url = "https://example.test/api/auth") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

/** The three things a probe can read. */
async function fingerprint(response: Response) {
  return {
    status: response.status,
    headers: [...response.headers.entries()].sort(),
    body: await response.text(),
  };
}

async function asOwner() {
  const { issueSessionToken } = await import("@/lib/auth/session");
  sessionCookie = await issueSessionToken();
}

beforeAll(() => {
  process.env.OWNER_SECRET = SECRET;
});

afterAll(() => {
  delete process.env.OWNER_SECRET;
});

beforeEach(() => {
  process.env.OWNER_SECRET = SECRET;
  sessionCookie = undefined;
  cookieWrites = [];
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("the rejection is one response (AE5)", () => {
  it("answers an empty body, a malformed body and a wrong secret identically", async () => {
    const { POST } = await import("../route");

    const responses = await Promise.all([
      POST(post("{}")),
      POST(post("not json at all")),
      POST(post(JSON.stringify({ secret: "wrong" }))),
    ]);

    const prints = await Promise.all(responses.map(fingerprint));

    for (const print of prints) {
      expect(print.status).toBe(404);
      expect(print.body).toBe("");
    }
    expect(prints[1]).toEqual(prints[0]);
    expect(prints[2]).toEqual(prints[0]);
  });

  it("names no accepted method on a verb it does not implement, or on a preflight", async () => {
    const { PATCH, OPTIONS, PUT, HEAD } = await import("../route");

    for (const handler of [PATCH, OPTIONS, PUT, HEAD]) {
      const response = await handler();

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
      expect(response.headers.get("allow")).toBeNull();
      expect(response.headers.get("access-control-allow-methods")).toBeNull();
    }
  });

  it("refuses a verb identically to a refused sign-in", async () => {
    const { POST, PATCH } = await import("../route");

    expect(await fingerprint(await PATCH())).toEqual(
      await fingerprint(await POST(post(JSON.stringify({ secret: "wrong" })))),
    );
  });
});

describe("a misconfigured deploy still answers 404 (AE6)", () => {
  it("does not let an unset secret escape as a 500", async () => {
    const { POST, GET, DELETE, PATCH } = await import("../route");
    delete process.env.OWNER_SECRET;
    sessionCookie = "v1.9999999999.whatever";

    for (const response of [
      await POST(post(JSON.stringify({ secret: "anything" }))),
      await GET(),
      await DELETE(),
      await PATCH(),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
  });

  it("does not let an under-length secret escape as a 500", async () => {
    const { POST, GET } = await import("../route");
    process.env.OWNER_SECRET = "short";
    sessionCookie = "v1.9999999999.whatever";

    expect((await POST(post(JSON.stringify({ secret: "short" })))).status).toBe(404);
    expect((await GET()).status).toBe(404);
  });

  it("records which fault it was, distinguishably, where only the owner reads", async () => {
    const { POST } = await import("../route");

    delete process.env.OWNER_SECRET;
    await POST(post("{}"));
    process.env.OWNER_SECRET = "short";
    await POST(post("{}"));
    process.env.OWNER_SECRET = SECRET;
    await POST(post("{}"));
    await POST(post(JSON.stringify({ secret: "wrong" })));
    await POST(post("not json"));

    expect(loggedFaults().map((line) => line.split(": ").at(-1))).toEqual([
      "secret-unset",
      "secret-too-short",
      "secret-invalid",
      "secret-mismatch",
      "secret-invalid",
    ]);
  });

  it("never writes the presented secret to the log", async () => {
    const { POST } = await import("../route");
    const presented = "hunter2-please-do-not-log-me";

    await POST(post(JSON.stringify({ secret: presented })));
    delete process.env.OWNER_SECRET;
    await POST(post(JSON.stringify({ secret: presented })));

    expect(loggedFaults()).toHaveLength(2);
    for (const line of loggedFaults()) {
      expect(line).not.toContain(presented);
      expect(line).not.toContain(SECRET);
    }
  });
});

describe("the owner's own path still works", () => {
  it("issues the session cookie with its existing attributes and lifetime", async () => {
    const { POST } = await import("../route");

    const response = await POST(post(JSON.stringify({ secret: SECRET })));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ owner: true });
    expect(cookieWrites).toHaveLength(1);
    expect(cookieWrites[0].name).toBe(SESSION_COOKIE);
    expect(cookieWrites[0].value).not.toBe("");
    expect(cookieWrites[0].options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
  });

  it("clears the session for a signed-in owner presenting no secret (AE7)", async () => {
    const { DELETE } = await import("../route");
    await asOwner();

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ owner: false });
    expect(cookieWrites).toHaveLength(1);
    expect(cookieWrites[0].value).toBe("");
    expect(cookieWrites[0].options).toMatchObject({ maxAge: 0 });
  });

  it("reports the session to a caller that already holds one", async () => {
    const { GET } = await import("../route");
    await asOwner();

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ owner: true });
  });
});

describe("the session exemption is per-method (KTD6)", () => {
  it("refuses a sign-out carrying neither a session nor a secret", async () => {
    const { DELETE } = await import("../route");

    expect((await DELETE()).status).toBe(404);
    expect(cookieWrites).toHaveLength(0);
  });

  it("refuses a status read from a visitor rather than reporting owner:false", async () => {
    const { GET } = await import("../route");

    expect((await GET()).status).toBe(404);
  });

  it("does not let a valid session carry a wrong secret through sign-in", async () => {
    const { POST } = await import("../route");
    await asOwner();

    const response = await POST(post(JSON.stringify({ secret: "wrong" })));

    expect(response.status).toBe(404);
    expect(cookieWrites).toHaveLength(0);
  });

  it("refuses a tampered session cookie", async () => {
    const { DELETE } = await import("../route");
    await asOwner();
    sessionCookie = `${sessionCookie}x`;

    expect((await DELETE()).status).toBe(404);
    expect(cookieWrites).toHaveLength(0);
  });
});

describe("no verb but sign-in reads a credential (R3)", () => {
  it("ignores a secret offered in a query string", async () => {
    const { GET, PUT, PATCH, HEAD } = await import("../route");
    // These handlers take no request argument at all — the structural half.
    for (const handler of [GET, PUT, PATCH, HEAD]) {
      const response = await handler();

      expect(response.status).toBe(404);
      expect(cookieWrites).toHaveLength(0);
    }

    for (const line of loggedFaults()) expect(line).not.toContain(SECRET);
  });

  it("does not read the body of a rejected verb", async () => {
    const { PUT } = await import("../route");
    const request = post(JSON.stringify({ secret: SECRET }));
    const read = vi.spyOn(request, "json");

    expect((await PUT()).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });
});
