// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROFILE } from "../profile";

// Anchored to this module rather than the working directory, and kept out of
// `new URL(..., import.meta.url)` so Vite has no template to expand into an
// asset glob. See solutions/test-failures/vitest-source-reader-avoids-vite-asset-glob.md
const sourceDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("the client boundary", () => {
  const source = readFileSync(resolve(sourceDirectory, "profile.ts"), "utf8");

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

  it("only links over http(s), mailto, or a root-relative path, which no validator checks anymore", () => {
    for (const link of PROFILE.links) {
      expect(link.label).toBeTruthy();
      expect(link.href).toMatch(/^(https?:\/\/|mailto:|\/(?!\/))/);
    }
  });

  it("points every root-relative link at a committed public file", () => {
    const publicDirectory = resolve(sourceDirectory, "../../../public");

    for (const link of PROFILE.links.filter((l) => /^\/(?!\/)/.test(l.href))) {
      expect(existsSync(resolve(publicDirectory, `.${link.href}`))).toBe(true);
    }
  });
});
