import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("drizzle/0092_product_record_append_only.sql", "utf8");

describe("product record append-only history", () => {
  it("rejects revision and command-receipt mutation at the database boundary", () => {
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "workspace_product_record_revisions"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "workspace_product_command_receipts"');
    expect(migration).toContain("Workspace product history is append-only");
  });
});
