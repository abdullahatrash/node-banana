import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), "src/components/governance/GovernanceWorkflows.tsx");
const contractPath = resolve(process.cwd(), "src/lib/governance/portability-contract.ts");

describe("governance client import boundary", () => {
  it("keeps portable-kind UI metadata outside the server-only portability implementation", () => {
    const workflowSource = readFileSync(workflowPath, "utf8");

    expect(workflowSource).not.toMatch(
      /from\s+["']@\/lib\/governance\/portability["']/,
    );
    expect(workflowSource).toContain(
      'from "@/lib/governance/portability-contract"',
    );
    expect(existsSync(contractPath)).toBe(true);

    if (!existsSync(contractPath)) return;
    const contractSource = readFileSync(contractPath, "utf8");
    for (const serverDependency of [
      "@/lib/db",
      "@/lib/storage",
      "region-enforcement",
      "postgres-repository",
    ]) {
      expect(contractSource).not.toContain(serverDependency);
    }
  });
});
