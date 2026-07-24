import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("canonical Workflow authorization resources", () => {
  it("resolves Workflow grants exclusively against content_workflows", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/lib/agent-authorization/repository.ts",
      ),
      "utf8",
    );
    const resolver = source.slice(
      source.indexOf("private async findActiveResourcesWith("),
      source.indexOf("\n  async issueAttenuatedKey("),
    );

    expect(source).toContain("contentWorkflows,");
    expect(resolver).toContain(".from(contentWorkflows)");
    expect(resolver).toContain(
      "eq(contentWorkflows.workspaceId, workspaceId)",
    );
    expect(resolver).toContain(
      "inArray(contentWorkflows.id, workflowIds)",
    );
    expect(source).not.toContain("projects,");
    expect(resolver).not.toContain(".from(projects)");
    expect(resolver).not.toContain("workflowJson");
  });
});
