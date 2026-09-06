import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Workspace preferences schema", () => {
  it("registers a constrained content-market migration", () => {
    const migration = readFileSync("drizzle/0126_workspace_preferences.sql", "utf8");
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: Array<{ idx: number; tag: string }> };

    expect(migration).toContain('ADD COLUMN "content_market"');
    expect(migration).toContain('CONSTRAINT "workspace_settings_content_market_check"');
    expect(journal.entries).toContainEqual(expect.objectContaining({ idx: 126, tag: "0126_workspace_preferences" }));
  });
});
