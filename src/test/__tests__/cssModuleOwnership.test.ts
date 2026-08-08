import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { scanCssModuleOwnership } from "../cssModuleOwnership";

const fixtureRoots: string[] = [];

function createFixture(files: Record<string, string>) {
  const sourceRoot = mkdtempSync(join(tmpdir(), "xencomp-css-ownership-"));
  fixtureRoots.push(sourceRoot);

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = join(sourceRoot, relativePath);
    mkdirSync(join(absolutePath, ".."), { recursive: true });
    writeFileSync(absolutePath, contents);
  }

  return sourceRoot;
}

afterEach(() => {
  for (const fixtureRoot of fixtureRoots.splice(0)) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

describe("scanCssModuleOwnership", () => {
  it("keeps every repository CSS Module with exactly one production owner", () => {
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

    expect(scanCssModuleOwnership({ sourceRoot })).toEqual([]);
  });

  it("accepts one production owner for each CSS Module", () => {
    const sourceRoot = createFixture({
      "components/card/Card.module.css": ".card {}",
      "components/card/Card.tsx": 'import styles from "./Card.module.css";',
      "widgets/music/Music.module.css": ".music {}",
      "widgets/music/Music.tsx": 'import styles from "@/widgets/music/Music.module.css";',
    });

    expect(scanCssModuleOwnership({ sourceRoot })).toEqual([]);
  });

  it("rejects plain CSS outside the two global stylesheet boundaries", () => {
    const sourceRoot = createFixture({
      "app/globals.css": ":root {}",
      "components/glass/tokens.css": ":root {}",
      "components/card/card.css": ".card {}",
    });

    expect(scanCssModuleOwnership({ sourceRoot })).toEqual([
      {
        stylesheet: "components/card/card.css",
        owners: [],
        reasons: ["unauthorized-global"],
      },
    ]);
  });

  it("requires the TSX owner and CSS Module to share a named component folder", () => {
    const sourceRoot = createFixture({
      "components/shared/ThemeToggle.module.css": ".toggle {}",
      "components/shared/ThemeToggle.tsx":
        'import styles from "./ThemeToggle.module.css";',
    });

    expect(scanCssModuleOwnership({ sourceRoot })).toEqual([
      {
        stylesheet: "components/shared/ThemeToggle.module.css",
        owners: ["components/shared/ThemeToggle.tsx"],
        reasons: ["wrong-folder"],
      },
    ]);
  });

  it("reports a sole importer that is not the colocated TSX owner", () => {
    const sourceRoot = createFixture({
      "components/Card/Card.module.css": ".card {}",
      "components/Card/Card.tsx": "export function Card() { return null; }",
      "components/Card/Decorator.tsx": 'import styles from "./Card.module.css";',
    });

    expect(scanCssModuleOwnership({ sourceRoot })).toEqual([
      {
        stylesheet: "components/Card/Card.module.css",
        owners: ["components/Card/Decorator.tsx"],
        reasons: ["wrong-owner"],
      },
    ]);
  });

  it("reports unowned and multiply owned modules with production importer paths", () => {
    const sourceRoot = createFixture({
      "components/orphan/Orphan.module.css": ".orphan {}",
      "components/shared/Shared.module.css": ".shared {}",
      "components/a/A.tsx": 'import styles from "../shared/Shared.module.css";',
      "components/b/B.ts": 'import styles from "@/components/shared/Shared.module.css";',
      "components/shared/Shared.test.tsx": 'import styles from "./Shared.module.css";',
      "components/shared/Shared.spec.ts": 'import styles from "./Shared.module.css";',
      "components/shared/__tests__/Shared.test.tsx":
        'import styles from "../Shared.module.css";',
    });

    expect(scanCssModuleOwnership({ sourceRoot })).toEqual([
      {
        stylesheet: "components/orphan/Orphan.module.css",
        owners: [],
        reasons: ["orphan"],
      },
      {
        stylesheet: "components/shared/Shared.module.css",
        owners: ["components/a/A.tsx", "components/b/B.ts"],
        reasons: ["multiple-owners"],
      },
    ]);
  });
});
