import { readdirSync } from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import ts from "typescript";

export interface CssModuleOwnershipIssue {
  stylesheet: string;
  owners: string[];
  reasons: Array<
    | "orphan"
    | "multiple-owners"
    | "wrong-owner"
    | "wrong-folder"
    | "unauthorized-global"
  >;
}

interface ScanOptions {
  sourceRoot: string;
  allowedGlobalStylesheets?: string[];
}

const DEFAULT_GLOBAL_STYLESHEETS = ["app/globals.css", "components/glass/tokens.css"];

function walk(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function toRelativePath(sourceRoot: string, path: string) {
  return relative(sourceRoot, path).split(sep).join("/");
}

function isProductionSource(path: string, sourceRoot: string) {
  const relativePath = toRelativePath(sourceRoot, path);
  return (
    !relativePath.split("/").includes("__tests__") &&
    !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relativePath) &&
    !relativePath.endsWith(".d.ts")
  );
}

function resolveImport(sourceRoot: string, importer: string, specifier: string) {
  if (specifier.startsWith("@/")) return resolve(sourceRoot, specifier.slice(2));
  if (specifier.startsWith(".")) return resolve(dirname(importer), specifier);
  return undefined;
}

export function scanCssModuleOwnership({
  sourceRoot,
  allowedGlobalStylesheets = DEFAULT_GLOBAL_STYLESHEETS,
}: ScanOptions): CssModuleOwnershipIssue[] {
  const absoluteSourceRoot = resolve(sourceRoot);
  const files = walk(absoluteSourceRoot);
  const unauthorizedGlobalStylesheets = files
    .filter((path) => path.endsWith(".css") && !path.endsWith(".module.css"))
    .map((path) => toRelativePath(absoluteSourceRoot, path))
    .filter((path) => !allowedGlobalStylesheets.includes(path));
  const stylesheets = files.filter((path) => path.endsWith(".module.css"));
  const ownersByStylesheet = new Map(stylesheets.map((path) => [path, new Set<string>()]));

  for (const sourcePath of files.filter(
    (path) => [".ts", ".tsx"].includes(extname(path)) && isProductionSource(path, absoluteSourceRoot),
  )) {
    const source = ts.createSourceFile(
      sourcePath,
      // The scanner only needs the import graph, so reading through TypeScript keeps syntax handling
      // correct without evaluating production modules.
      ts.sys.readFile(sourcePath) ?? "",
      ts.ScriptTarget.Latest,
      false,
      sourcePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }

      const specifier = statement.moduleSpecifier.text;
      if (!specifier.endsWith(".module.css")) continue;
      const importedPath = resolveImport(absoluteSourceRoot, sourcePath, specifier);
      if (!importedPath) continue;
      ownersByStylesheet.get(importedPath)?.add(toRelativePath(absoluteSourceRoot, sourcePath));
    }
  }

  const ownershipIssues = [...ownersByStylesheet]
    .map(([absoluteStylesheet, ownerSet]) => {
      const stylesheet = toRelativePath(absoluteSourceRoot, absoluteStylesheet);
      const owners = [...ownerSet].sort();
      const componentName = basename(stylesheet, ".module.css");
      const componentFolder = basename(dirname(stylesheet));
      const expectedOwner = stylesheet.replace(/\.module\.css$/, ".tsx");
      const reasons: CssModuleOwnershipIssue["reasons"] = [];
      if (owners.length === 0) reasons.push("orphan");
      if (owners.length > 1) reasons.push("multiple-owners");
      if (owners.length === 1 && owners[0] !== expectedOwner) reasons.push("wrong-owner");
      if (componentFolder.toLowerCase() !== componentName.toLowerCase()) {
        reasons.push("wrong-folder");
      }
      return { stylesheet, owners, reasons };
    })
    .filter(({ reasons }) => reasons.length > 0);

  return [
    ...ownershipIssues,
    ...unauthorizedGlobalStylesheets.map((stylesheet) => ({
      stylesheet,
      owners: [],
      reasons: ["unauthorized-global"] as CssModuleOwnershipIssue["reasons"],
    })),
  ]
    .sort((left, right) => left.stylesheet.localeCompare(right.stylesheet));
}
