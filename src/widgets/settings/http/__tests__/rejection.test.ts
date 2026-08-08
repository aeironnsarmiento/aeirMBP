import { describe, expect, it } from "vitest";
import { failureMessage } from "../rejection";

function rejection(status: number, body?: unknown) {
  return body === undefined
    ? new Response(null, { status })
    : Response.json(body, { status });
}

describe("a rejection with no body", () => {
  it("surfaces the refusal rather than a parse error", async () => {
    const message = await failureMessage(rejection(404));

    expect(message).not.toMatch(/JSON|Unexpected|parse/i);
    expect(message).toContain("404");
    expect(message).toMatch(/session|secret/i);
  });

  it("falls back to the status for any other bodiless failure", async () => {
    expect(await failureMessage(rejection(500))).toBe("HTTP 500");
    expect(await failureMessage(rejection(502))).toBe("HTTP 502");
  });

  it("does not throw on a body that is not JSON at all", async () => {
    const response = new Response("<html>gateway error</html>", { status: 502 });

    expect(await failureMessage(response)).toBe("HTTP 502");
  });
});

describe("a rejection that does carry a body", () => {
  it("still surfaces the error field", async () => {
    const message = await failureMessage(
      rejection(422, { error: "Pane opacity must be between 0.2 and 0.85" }),
    );

    expect(message).toBe("Pane opacity must be between 0.2 and 0.85");
  });

  it("falls back to the status when the body names no error", async () => {
    expect(await failureMessage(rejection(400, { field: "backgroundId" }))).toBe(
      "HTTP 400",
    );
  });
});
