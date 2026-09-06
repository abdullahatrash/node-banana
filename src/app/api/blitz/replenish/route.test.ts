import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/app/api/blitz/replenish/route.ts"), "utf8");

describe("Blitz replenish route", () => {
  it("is tenant-authenticated and never exposes caller-controlled policy or provider input", () => {
    expect(source).toContain('permission: "product:content:write"');
    expect(source).toContain("workspaceId: authz.workspaceId");
    expect(source).toContain("actorUserId: authz.userId");
    expect(source).not.toContain("provider");
    expect(source).not.toContain("budgetCents:");
  });
});
