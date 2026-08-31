import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("canonical Automation authorization resources", () => {
  it("resolves grants only against non-retired runtime Automations", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/agent-authorization/repository.ts"),
      "utf8",
    );
    const resolver = source.slice(
      source.indexOf("private async findActiveResourcesWith("),
      source.indexOf("\n  async issueAttenuatedKey("),
    );

    expect(source).toContain("runtimeAutomations,");
    expect(resolver).toContain(".from(runtimeAutomations)");
    expect(resolver).toContain(
      "eq(runtimeAutomations.workspaceId, workspaceId)",
    );
    expect(resolver).toContain(
      "inArray(runtimeAutomations.id, automationIds)",
    );
    expect(resolver).toContain(
      'inArray(runtimeAutomations.controlState, ["active", "paused"])',
    );
    expect(source).not.toContain("socialAutomationRules,");
    expect(resolver).not.toContain(".from(socialAutomationRules)");
  });
});
