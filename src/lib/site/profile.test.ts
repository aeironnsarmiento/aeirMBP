// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROFILE } from "./profile";

/**
 * The client boundary (KTD1).
 *
 * Nothing else in the suite can see this. Vitest renders server components as
 * plain functions outside the RSC graph, so the boundary is never crossed in
 * test, and typecheck, lint and build all pass regardless. A `"use client"`
 * directive here would hand a server component a client reference instead of
 * this object — fields would read as undefined rather than throwing, which is
 * quieter than the 500 the same mistake produced in
 * docs/solutions/runtime-errors/calling-a-use-client-export-from-a-server-component.md.
 */
describe("the client boundary", () => {
  const source = readFileSync("src/lib/site/profile.ts", "utf8");

  it("carries no use-client directive", () => {
    // A directive must be the first statement — and this file's own doc
    // comment says the words, so a substring check would false-positive.
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
    // validatePatch's href check went with the write path; source review is
    // what stands between a bad href and every visitor's page.
    for (const link of PROFILE.links) {
      expect(link.label).toBeTruthy();
      expect(link.href).toMatch(/^https?:\/\//);
    }
  });
});
