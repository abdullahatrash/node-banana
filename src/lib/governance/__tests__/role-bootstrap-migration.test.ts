import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canonical Workspace Role activation migration", () => {
  const sql = readFileSync("drizzle/0079_governance_role_assignment_bootstrap.sql", "utf8");

  it("backfills all active legacy members without replacing an exact assignment", () => {
    expect(sql).toContain('FROM "workspace_members" wm');
    expect(sql).toContain('w."deleted_at" IS NULL');
    expect(sql).toContain('ON CONFLICT ("workspace_id", "kind", "id") DO NOTHING');
    expect(sql).toContain("WHEN 'owner' THEN 'owner'");
    expect(sql).toContain("ELSE 'creator'");
  });

  it("provisions every future member assignment in the membership transaction", () => {
    expect(sql).toContain("CREATE TRIGGER \"workspace_members_governance_role_assignment\"");
    expect(sql).toContain('AFTER INSERT ON "workspace_members"');
    expect(sql).toContain("governance_provision_member_role_assignment()");
  });
});
