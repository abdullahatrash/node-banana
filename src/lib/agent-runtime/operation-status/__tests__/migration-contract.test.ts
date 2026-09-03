import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("operation status migration", () => {
  it("pins all canonical states, history, idempotency and workspace indexes", () => {
    const sql = readFileSync("drizzle/0069_runtime_operation_status.sql", "utf8");
    for (const state of ["queued","admitted","running","waiting_user","waiting_provider","waiting_quota","waiting_time","blocked","cancelling","cancelled","succeeded","failed_known","outcome_unknown"]) expect(sql).toContain(`'${state}'`);
    expect(sql).toContain("runtime_operation_events");
    expect(sql).toContain("runtime_operation_mutation_receipts");
    expect(sql).toContain("runtime_operations_workspace_state_time_idx");
  });
});
describe("operation projection lease migration", () => { it("registers durable per-workspace leases", () => { const sql = readFileSync("drizzle/0074_operation_projection_leases.sql", "utf8"); expect(sql).toContain("runtime_operation_projection_leases"); expect(sql).toContain("lease_expires_at"); }); });
