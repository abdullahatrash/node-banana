import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0048_runtime_publishing_deliveries.sql"),
  "utf8",
);

describe("Publishing Delivery migration contract", () => {
  it("creates exact releases, per-target deliveries, events, outbox, and fenced leases", () => {
    for (const table of [
      "runtime_publishing_delivery_releases",
      "runtime_publishing_delivery_release_receipts",
      "runtime_publishing_deliveries",
      "runtime_publishing_delivery_events",
      "runtime_publishing_delivery_outbox_intents",
      "runtime_publishing_delivery_execution_leases",
    ]) expect(migration).toContain(`CREATE TABLE "${table}"`);
    expect(migration).toContain("runtime_publishing_delivery_releases_consumption_fk");
    expect(migration).toContain("runtime_publishing_delivery_releases_exact_identity_unique");
    expect(migration).toContain("runtime_publishing_delivery_release_acceptance_complete");
    expect(migration).toContain(
      'jsonb_array_length("runtime_publishing_deliveries"."artifact_ids") between 1 and 51',
    );
  });

  it("orders prerequisite unique indexes before their dependent foreign keys", () => {
    expect(migration.indexOf("runtime_publishing_approval_consumptions_release_identity_unique"))
      .toBeLessThan(migration.indexOf("runtime_publishing_delivery_releases_consumption_fk"));
    expect(migration.indexOf("runtime_publishing_delivery_releases_exact_identity_unique"))
      .toBeLessThan(migration.indexOf("runtime_publishing_deliveries_release_fk"));
    expect(migration.match(/runtime_publishing_delivery_releases_key_fk/g)).toHaveLength(1);
  });

  it("installs append-only history, guarded events, outbox monotonicity, and fencing", () => {
    for (const name of [
      "runtime_publishing_delivery_releases_insert_only",
      "runtime_publishing_delivery_release_receipts_insert_only",
      "runtime_publishing_delivery_events_insert_only",
      "runtime_publishing_delivery_events_canonical",
      "runtime_publishing_deliveries_identity_immutable",
      "runtime_publishing_delivery_outbox_identity_immutable",
      "runtime_publishing_delivery_lease_fence_monotonic",
    ]) expect(migration).toContain(name);
    expect(migration).toContain("Publishing Delivery follow-up outbox is missing");
    expect(migration).toContain("Publishing Delivery accepted projection diverges");
  });
});
