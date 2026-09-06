import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Workspace Interface Locale persistence", () => {
  it("enforces membership-scoped identity and migrates legacy preferences without cross-Workspace reads", () => {
    const migration = readFileSync(join(process.cwd(), "drizzle/0105_workspace_interface_locales.sql"), "utf8");
    const repository = readFileSync(join(process.cwd(), "src/lib/interface-locale/repository.ts"), "utf8");
    expect(migration).toContain('PRIMARY KEY("workspace_id", "user_id")');
    expect(migration).toContain('FOREIGN KEY ("workspace_id", "user_id")');
    expect(migration).toContain('REFERENCES "workspace_members"("workspace_id", "user_id")');
    expect(migration).toContain('INNER JOIN "user_preferences" preference ON preference."user_id" = member."user_id"');
    expect(repository).toContain("eq(workspaceMembers.workspaceId, workspaceId)");
    expect(repository).toContain("eq(workspaceMembers.userId, userId)");
    expect(repository).toContain("eq(workspaceInterfaceLocalePreferences.workspaceId, workspaceMembers.workspaceId)");
    expect(repository).toContain("eq(workspaceInterfaceLocalePreferences.userId, workspaceMembers.userId)");
  });
});
