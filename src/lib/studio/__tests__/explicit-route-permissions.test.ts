import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { authorizeStudioRequest, ContentOSPermission } from "@/lib/studio/authz";
import type { WithStudioAuthOptions } from "@/lib/studio/withStudioAuth";

type IsOptional<T, K extends keyof T> = Record<string, never> extends Pick<T, K> ? true : false;
const withStudioPermissionOptional: IsOptional<WithStudioAuthOptions, "permission"> = false;
const directPermissionOptional: IsOptional<Parameters<typeof authorizeStudioRequest>[1], "permission"> = false;
void withStudioPermissionOptional;
void directPermissionOptional;

const VALID_PERMISSIONS = new Set<ContentOSPermission>([
  "workspaces:read", "workspaces:write", "workspaces:delete", "projects:read", "projects:write", "projects:delete",
  "assets:read", "assets:write", "assets:delete", "social:view", "social:connect", "social:publish", "social:manage",
  "product:read", "product:personas:read", "product:personas:manage", "product:billing:read", "product:billing:manage",
  "product:billing:purchase", "product:billing:refund", "product:content:write", "product:inspiration:write",
  "product:campaigns:write", "product:analytics:write", "product:support:submit",
]);

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

function missingExplicitPermissions(file: string) {
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const failures: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["withStudioAuth", "authorizeStudioRequest"].includes(node.expression.text)) {
      const argument = node.expression.text === "withStudioAuth" ? node.arguments[0] : node.arguments[1];
      if (argument && ts.isObjectLiteralExpression(argument)) {
        const property = argument.properties.find((candidate): candidate is ts.PropertyAssignment => ts.isPropertyAssignment(candidate) && candidate.name.getText(tree) === "permission");
        const value = property && ts.isStringLiteral(property.initializer) ? property.initializer.text : null;
        if (!value || !VALID_PERMISSIONS.has(value as ContentOSPermission)) failures.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return failures;
}

describe("explicit Studio route authorization", () => {
  it("requires a valid literal capability at every API call site", () => {
    const files = [...routeFiles(join(process.cwd(), "src/app/api")), join(process.cwd(), "src/lib/model-routing/admitted-generation-http.ts")];
    expect(files.flatMap(missingExplicitPermissions)).toEqual([]);
  });

  it("contains no route substring or broad fallback permission inference", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/studio/authz.ts"), "utf8");
    expect(source).not.toContain("mapActionToPermission");
    expect(source).not.toMatch(/options\.permission\s*\?\?/);
  });
});
