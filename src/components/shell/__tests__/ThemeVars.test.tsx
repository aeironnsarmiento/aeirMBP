import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/site/schema";
import { backgroundsFixture } from "../testSite";
import { ThemeVars } from "../ThemeVars";

// The first-paint channel (R12, R13). Static markup, not jsdom: what matters
// is the bytes the server sends, and jsdom runs no cascade. AE4 and AE8 are
// verified in a real browser; this guards the input to that.

function markup(overrides: Partial<SiteSettings> = {}, urls = {}) {
  const settings = { ...DEFAULT_SITE_SETTINGS, ...overrides };
  return renderToStaticMarkup(
    <ThemeVars
      settings={settings}
      backgrounds={backgroundsFixture(settings, urls)}
    />,
  );
}

const PAIR = { backgroundLightId: "frost", backgroundDarkId: "orchid" };

describe("the background reaches every cascade layer", () => {
  it("emits both members of a pair, so a toggle needs no network (AE8)", () => {
    const html = markup(PAIR);

    expect(html).toContain("/backgrounds/frost.svg");
    expect(html).toContain("/backgrounds/orchid.svg");
  });

  it("puts the dark member inside the OS media query (AE4)", () => {
    // The reader with no stored choice and no schedule carries no attribute at
    // all, so this layer is the only one that can reach them.
    const html = markup(PAIR);

    expect(html).toContain(
      '@media (prefers-color-scheme:dark){:root{--bg-image:url(\"/backgrounds/orchid.svg\")}}',
    );
  });

  it("puts the light member on the bare root, which is the light layer", () => {
    expect(markup(PAIR)).toContain(
      ':root{--bg-image:url(\"/backgrounds/frost.svg\")}',
    );
  });

  it("publishes both explicit-appearance selectors", () => {
    const html = markup(PAIR);

    expect(html).toContain(
      ':root[data-theme=\"light\"]{--bg-image:url(\"/backgrounds/frost.svg\")}',
    );
    expect(html).toContain(
      ':root[data-theme=\"dark\"]{--bg-image:url(\"/backgrounds/orchid.svg\")}',
    );
  });

  it("emits one source under every layer for a single background (AE2)", () => {
    const html = markup({ backgroundId: "dune" });

    expect(html.match(/\/backgrounds\/dune\.svg/g)).toHaveLength(4);
    expect(html).not.toContain("frost");
  });

  it("fills an emptied slot with a mood-matched preset (AE3)", () => {
    const html = markup({ backgroundDarkId: "orchid" });

    expect(html).toContain("/backgrounds/orchid.svg");
    expect(html).toContain("/backgrounds/frost.svg");
  });
});

describe("a video background", () => {
  it("emits no per-mode property, leaving the element path unchanged", () => {
    const html = markup(
      { backgroundId: "custom", backgroundPath: "background/1.mp4" },
      { single: "https://cdn.example/background/1.mp4" },
    );

    expect(html).not.toContain("--bg-image");
    expect(html).not.toContain("prefers-color-scheme");
  });
});

describe("values are re-clamped and re-checked on the way out", () => {
  it("clamps an out-of-range opacity rather than writing it into the sheet", () => {
    const html = markup({ frameOpacity: 9, paneOpacity: -4 });

    expect(html).toContain("--glass-alpha-frame:0.850");
    expect(html).toContain("--glass-alpha-pane:0.200");
  });

  it("refuses a crafted source rather than letting it close the declaration", () => {
    const html = markup(
      { backgroundId: "custom", backgroundPath: "background/1.png" },
      { single: '/x.png") ;} :root{--ink:red} /*' },
    );

    expect(html).toContain("--bg-image:none");
    expect(html).not.toContain("--ink:red");
  });

  it("refuses a source that would close the style element", () => {
    const html = markup(
      { backgroundId: "custom", backgroundPath: "background/1.png" },
      { single: "/x.png</style><script>alert(1)</script>" },
    );

    expect(html).toContain("--bg-image:none");
    expect(html).not.toContain("alert(1)");
  });
});

describe("the pre-paint script", () => {
  it("carries the owner's schedule when one is configured", () => {
    const html = markup({ themeSwitchoverAt: "19:00", themeSwitchoverTo: "dark" });

    expect(html).toContain("19:00|dark");
    expect(html).toContain("dataset.theme");
  });

  it("carries no schedule when the owner has not set one (R12)", () => {
    const html = markup();

    expect(html).toContain('var s=""');
  });

  it("ignores a stored time the schema no longer allows", () => {
    const html = markup({ themeSwitchoverAt: "25:00" as string });

    expect(html).toContain('var s=""');
  });

  it("is the only writer of the theme attribute", () => {
    // The root layout used to render a second one. Two writers of one
    // attribute is a trap; this is the assertion that keeps it at one.
    const html = markup(PAIR);

    expect(html.match(/dataset\.theme\s*=/g)).toHaveLength(1);
  });
});

describe("the client boundary", () => {
  // Nothing else in the suite can see this: rendering ThemeVars here runs it
  // outside the RSC graph, and typecheck, lint and build all pass. It surfaces
  // as a 500 on every page load the first time the app is run.
  it("imports the boot script from a module with no use-client directive", async () => {
    const { readFileSync } = await import("node:fs");

    const source = readFileSync("src/components/shell/ThemeVars.tsx", "utf8");
    const match = source.match(/from "([^"]*themeContract[^"]*)"/);
    expect(match, "ThemeVars must import from themeContract").not.toBeNull();

    const contract = readFileSync(
      "src/components/glass/themeContract.ts",
      "utf8",
    );
    // A directive must be the first statement — and the file's own doc
    // comment says the words, so a substring check would false-positive.
    const firstStatement = contract
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .trimStart();
    expect(firstStatement.startsWith('"use client"')).toBe(false);
    expect(firstStatement.startsWith("'use client'")).toBe(false);
    expect(source).not.toContain("glass/useTheme");
  });
});
