import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vitest";
import { PROVIDER_ADAPTER_MANIFEST } from "@/lib/provider-adapters/manifest";
import type { WorkflowRunExecutorRegistry } from "../executors";
import type { ProviderEffectRequest } from "../provider-adapter";

const ROOT = resolve(process.cwd(), "src/lib/provider-adapters");
const RUNTIME_BOUNDARY = "@/lib/agent-runtime/runs/provider-adapter";
const ALLOWED_EXTERNAL_MODULES = new Set(["zod", "@google/genai"]);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(path)
        : Promise.resolve(
            [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [],
          );
    }),
  );
  return nested.flat();
}

function moduleSpecifiers(source: string, file: string): string[] {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      specifiers.push(node.arguments[0]!.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return specifiers;
}

describe("Provider Adapter architecture boundary", () => {
  it("exposes no domain authority in the invocation contract", () => {
    type Keys = keyof ProviderEffectRequest<{ prompt: string }>;
    expectTypeOf<Keys>().toEqualTypeOf<
      "effectKey" | "intentDigest" | "intent" | "credentials"
    >();
    expectTypeOf<keyof WorkflowRunExecutorRegistry>().toEqualTypeOf<
      "get" | "resolve" | "getPinned" | "registerProviderAdapter"
    >();
  });

  it("allows only the adapter boundary or adapter-local application imports", async () => {
    const entries = await sourceFiles(ROOT);
    expect(entries.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const entry of entries) {
      const source = await readFile(entry, "utf8");
      for (const specifier of moduleSpecifiers(source, entry)) {
        if (specifier.startsWith("@/") && specifier !== RUNTIME_BOUNDARY) {
          violations.push(`${relative(process.cwd(), entry)} -> ${specifier}`);
        }
        if (specifier.startsWith(".")) {
          const target = resolve(dirname(entry), specifier);
          if (target !== ROOT && !target.startsWith(`${ROOT}${sep}`)) {
            violations.push(`${relative(process.cwd(), entry)} -> ${specifier}`);
          }
        }
        if (
          !specifier.startsWith("@/") &&
          !specifier.startsWith(".") &&
          !ALLOWED_EXTERNAL_MODULES.has(specifier)
        ) {
          violations.push(`${relative(process.cwd(), entry)} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("requires every provider-adapter module to be declared in the manifest", async () => {
    const modules = (await sourceFiles(ROOT))
      .map((entry) => relative(ROOT, entry).replace(/\.[^.]+$/, ""))
      .filter((entry) => entry !== "manifest")
      .sort();
    expect(
      [...new Set(PROVIDER_ADAPTER_MANIFEST.map((entry) => entry.module))].sort(),
    ).toEqual(modules);
  });
});
