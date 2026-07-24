import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function migration(name: string): string {
  return readFileSync(resolve(process.cwd(), "drizzle", name), "utf8");
}

describe("Agent authorization migration contracts", () => {
  it("backfills policy revisions before enforcing active revision nullability", () => {
    const sql = migration("0018_glorious_warbound.sql");
    const backfill = sql.indexOf(
      'INSERT INTO "workspace_agent_policy_revisions"',
    );
    const notNull = sql.indexOf(
      'ALTER COLUMN "active_revision_id" SET NOT NULL',
    );

    expect(backfill).toBeGreaterThan(-1);
    expect(notNull).toBeGreaterThan(backfill);
  });

  it("establishes the composite target key before the tenant-safe policy FK", () => {
    const sql = migration("0020_conscious_edwin_jarvis.sql");
    const targetKey = sql.indexOf(
      '"workspace_agent_policy_revisions_workspace_id_unique"',
    );
    const compositeFk = sql.indexOf(
      '"workspace_agent_policies_active_revision_workspace_fk"',
    );

    expect(targetKey).toBeGreaterThan(-1);
    expect(compositeFk).toBeGreaterThan(targetKey);
    expect(sql).toContain('DROP TABLE "workflows"');
    expect(sql).toContain('"principal_status" text');
    expect(sql).toContain('"change_ref" text');
  });

  it("authorizes only live projects with stored workflow data", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/lib/agent-authorization/repository.ts",
      ),
      "utf8",
    );

    expect(source).toContain('eq(projects.status, "active")');
    expect(source).toContain("isNotNull(projects.workflowJson)");
    expect(source).toContain("isNull(projects.deletedAt)");
  });

  it("filters enumerated effective Credential Profiles through current database state", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/lib/agent-authorization/repository.ts",
      ),
      "utf8",
    );
    const activeResources = source.slice(
      source.indexOf("private async findActiveResourcesWith"),
    );
    expect(source).toContain(
      "effectiveResources.credentialProfileIds.map",
    );
    expect(activeResources).toContain(
      'eq(credentialProfiles.status, "active")',
    );
    expect(activeResources).toContain(
      "eq(credentialProfiles.enabled, true)",
    );
    expect(activeResources).toContain(
      "isNull(credentialProfiles.deletedAt)",
    );
  });

  it("stores replay receipts without plaintext or credential hashes", () => {
    const sql = migration("0021_parallel_alex_power.sql");

    expect(sql).toContain(
      '"agent_authority_provisioning_receipts_request_unique"',
    );
    expect(sql).toContain(
      '("workspace_id","actor_user_id","request_id")',
    );
    expect(sql).toContain('"request_fingerprint" text NOT NULL');
    expect(sql).not.toContain("plaintext");
    expect(sql).not.toContain("secret_hash");
  });

  it("locks the Workspace before reading absent policy state", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/lib/agent-authorization/repository.ts",
      ),
      "utf8",
    );
    const provision = source.slice(source.indexOf("async provisionAuthority"));
    const workspaceLock = provision.indexOf(".from(workspaces)");
    const policyRead = provision.indexOf(
      ".from(workspaceAgentPolicies)",
    );

    expect(workspaceLock).toBeGreaterThan(-1);
    expect(provision.slice(workspaceLock, policyRead)).toContain(
      '.for("update")',
    );
    expect(policyRead).toBeGreaterThan(workspaceLock);
  });

  it("keeps the generic dispatcher free of database composition", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/agent-tools/dispatcher.ts"),
      "utf8",
    );

    expect(source).not.toContain("@/lib/db");
    expect(source).not.toContain("DrizzleAgentAuthorizationRepository");
  });
});
