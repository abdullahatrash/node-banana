import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "drizzle/0119_workspace_owned_performance_trends.sql"), "utf8");

describe("Workspace-owned performance trend schema", () => {
  it("adds the explicit source kind and tenant-safe relational boundaries", () => {
    expect(migration).toContain("'workspace_owned_analytics'");
    expect(migration).toContain('CREATE TABLE "workspace_content_performance_observations"');
    expect(migration).toContain('workspace_content_performance_observations_post_fk');
    expect(migration).toContain('workspace_content_performance_observations_asset_fk');
    expect(migration).toContain('workspace_content_performance_observations_rights_snapshot_fk');
    expect(migration).toContain('workspace_content_performance_observations_cursor_idx');
    expect(migration).toContain('workspace_content_performance_observations_immutable');
    expect(migration).toContain('BEFORE UPDATE ON "workspace_content_performance_observations"');
  });

  it("accepts only explicit Workspace attestations with safe integer metrics", () => {
    expect(migration).toContain('"source_kind" = \'workspace_attested\'');
    expect(migration).toContain('"views" BETWEEN 0 AND 9007199254740991');
    expect(migration).toContain('"observed_at" <= "captured_at"');
    expect(migration).not.toContain("youtube");
  });
});
