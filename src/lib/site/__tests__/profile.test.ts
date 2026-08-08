// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROFILE } from "../profile";

describe("the client boundary", () => {
  const source = readFileSync("src/lib/site/profile.ts", "utf8");

  it("carries no use-client directive", () => {
    const firstStatement = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .trimStart();

    expect(firstStatement.startsWith('"use client"')).toBe(false);
    expect(firstStatement.startsWith("'use client'")).toBe(false);
  });

  it("imports nothing that reaches the database", () => {
    expect(source).not.toContain("@/lib/db");
    expect(source).not.toContain("drizzle");
    expect(source).not.toContain("./settings");
  });
});

describe("committed values", () => {
  it("carries a complete profile", () => {
    expect(PROFILE.name).toBeTruthy();
    expect(PROFILE.handle).toBeTruthy();
    expect(PROFILE.aboutCopy).toBeTruthy();
    expect(PROFILE.links.length).toBeGreaterThan(0);
  });

  it("only links off-site over http(s), which no validator checks anymore", () => {
    for (const link of PROFILE.links) {
      expect(link.label).toBeTruthy();
      expect(link.href).toMatch(/^https?:\/\//);
    }
  });
});
